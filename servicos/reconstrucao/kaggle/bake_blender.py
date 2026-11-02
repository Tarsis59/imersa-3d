"""Roda DENTRO do Blender (4.2 LTS): blender -b -P bake_blender.py -- --glb modelo.glb --saida pasta

Luz pré-calculada do prédio (Plano 12a, item 6): bake no Cycles, na GPU se houver, de:
- UV2 (`TEXCOORD_1`) por "lightmap pack" (uma UV só para o prédio inteiro, sem sobreposição entre peças) —
  é nela que as 3 texturas abaixo são lidas;
- oclusão ambiente (AO), em `ao.png`;
- luz difusa de dia (céu físico Nishita, sol às 16h30 — mesma hora de abertura padrão do Plano 12a, item 7),
  em `dia.png`;
- luz difusa de noite (sol apagado; janelas e postes — objetos/materiais com "janela", "poste" ou "luz" no
  nome — como emissivos), em `noite.png`.
O bake de dia/noite usa só as passagens direta + indireta (sem a cor do material): é luz pura, pensada para
multiplicar/somar no shader por cima da cor normal (ver `packages/viewer/src/bake/lightmap.ts`).

Saída: `baseline.glb` (o modelo com a UV2, cor e texturas de sempre), `ao.png`, `dia.png`, `noite.png` e
`bake.json`. Quem junta tudo num GLB só é o `imersa_recon.bake.anexar_lightmaps_no_glb` (fora do Blender, sem
precisar de GPU nem do Blender para testar).
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

import bpy  # type: ignore

UV_LIGHTMAP = "imersa_lightmap"
PADRAO_LUZ = re.compile(r"janela|poste|luz", re.IGNORECASE)


def argumentos():
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True)
    p.add_argument("--saida", required=True)
    p.add_argument("--largura", type=int, default=1024)
    p.add_argument("--amostras", type=int, default=128)
    p.add_argument("--gpu", action="store_true")
    return p.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def ligar_gpu(cena) -> str:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for tipo in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = tipo
        except TypeError:
            continue
        prefs.get_devices()
        if any(d.type == tipo for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == tipo
            cena.cycles.device = "GPU"
            return tipo
    cena.cycles.device = "CPU"
    return "CPU"


def criar_uv2(malhas: list) -> None:
    """UV2 (lightmap pack) para cada malha: uma UV só, sem peças se sobrepondo (bake não mistura unidades)."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in malhas:
        o.select_set(True)
    bpy.context.view_layer.objects.active = malhas[0]
    for o in malhas:
        if UV_LIGHTMAP not in o.data.uv_layers:
            o.data.uv_layers.new(name=UV_LIGHTMAP)
        o.data.uv_layers[UV_LIGHTMAP].active = True
        o.data.uv_layers[UV_LIGHTMAP].active_render = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        # operador feito para isto: UVs sem sobreposição, pensadas para bake de luz
        bpy.ops.uv.lightmap_pack(PREF_CONTEXT="SEL_FACES", PREF_MARGIN_DIV=0.2)
    except RuntimeError:
        # sem uma janela 3D (alguns Blender headless recusam o lightmap_pack fora dela): cai para o smart project
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


def imagem_de_bake(nome: str, largura: int):
    img = bpy.data.images.new(nome, width=largura, height=largura, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if nome == "ao" else "sRGB"
    return img


def preparar_nodes_de_bake(malhas: list, imagem) -> list:
    """Cada material ganha (ou reaproveita) um nó de imagem ligado à UV2, selecionado e ativo: onde o bake escreve."""
    nodes_criados = []
    vistos = set()
    for o in malhas:
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.name in vistos:
                continue
            vistos.add(m.name)
            if not m.use_nodes:
                m.use_nodes = True
            nt = m.node_tree
            for n in nt.nodes:
                n.select = False
            uv_node = nt.nodes.new("ShaderNodeUVMap")
            uv_node.uv_map = UV_LIGHTMAP
            tex_node = nt.nodes.new("ShaderNodeTexImage")
            tex_node.image = imagem
            nt.links.new(uv_node.outputs["UV"], tex_node.inputs["Vector"])
            tex_node.select = True
            nt.nodes.active = tex_node
            nodes_criados.append((nt, tex_node, uv_node))
    return nodes_criados


def remover_nodes_de_bake(nodes: list) -> None:
    for nt, tex_node, uv_node in nodes:
        nt.nodes.remove(tex_node)
        nt.nodes.remove(uv_node)


def luzes_de_noite(malhas: list) -> list:
    """Materiais com "janela"/"poste"/"luz" no nome (do objeto ou do material) ganham um Emission forte."""
    alterados = []
    for o in malhas:
        aceso = bool(PADRAO_LUZ.search(o.name))
        for slot in o.material_slots:
            m = slot.material
            if m is None or not (aceso or PADRAO_LUZ.search(m.name)):
                continue
            nt = m.node_tree
            saida = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            if saida is None or not saida.inputs["Surface"].links:
                continue
            principal = saida.inputs["Surface"].links[0].from_node
            if "Emission Strength" not in getattr(principal, "inputs", {}):
                continue
            antes = principal.inputs["Emission Strength"].default_value
            antes_cor = tuple(principal.inputs["Emission Color"].default_value) if "Emission Color" in principal.inputs else None
            principal.inputs["Emission Strength"].default_value = max(antes, 1.0) * 6.0
            if antes_cor:
                principal.inputs["Emission Color"].default_value = (1.0, 0.85, 0.55, 1.0)  # luz amarelada
            alterados.append((principal, antes, antes_cor))
    return alterados


def restaurar_noite(alterados: list) -> None:
    for principal, antes, antes_cor in alterados:
        principal.inputs["Emission Strength"].default_value = antes
        if antes_cor:
            principal.inputs["Emission Color"].default_value = antes_cor


def bake(cena, tipo: str, cor: bool) -> None:
    cena.cycles.bake_type = tipo
    # chamado por Python (fora do painel de Bake): o operador não lê `scene.render.bake.use_pass_*` por conta
    # própria, então o filtro de passagem precisa vir explícito no `pass_filter` (senão o bake sai todo preto).
    pass_filter: set[str] = set()
    if tipo in ("DIFFUSE", "GLOSSY", "TRANSMISSION"):
        cena.render.bake.use_pass_direct = True
        cena.render.bake.use_pass_indirect = True
        cena.render.bake.use_pass_color = cor
        pass_filter = {tipo, "DIRECT", "INDIRECT"} | ({"COLOR"} if cor else set())
    bpy.ops.object.bake(type=tipo, pass_filter=pass_filter, margin=4, use_clear=True)


def main() -> None:
    a = argumentos()
    saida = Path(a.saida)
    saida.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a.glb)
    cena = bpy.context.scene
    malhas = [o for o in cena.objects if o.type == "MESH" and o.get("ifc") != "IfcSpace"]
    if not malhas:
        raise SystemExit("modelo sem peças visíveis")

    pts = [o.matrix_world @ v.co for o in malhas for v in o.data.vertices]
    raio = max((max(p.x for p in pts) - min(p.x for p in pts)) / 2, (max(p.z for p in pts) - min(p.z for p in pts)) / 2, 0.5)

    criar_uv2(malhas)

    cena.render.engine = "CYCLES"
    cena.cycles.samples = a.amostras
    cena.cycles.use_denoising = True
    dispositivo = ligar_gpu(cena) if a.gpu else "CPU"

    # céu e sol de dia: mesma receita do giro (Nishita), mas na elevação de 16h30 (hora padrão de abertura)
    mundo = bpy.data.worlds.new("ceu")
    cena.world = mundo
    mundo.use_nodes = True
    ceu = mundo.node_tree.nodes.new("ShaderNodeTexSky")
    ceu.sky_type = "NISHITA"
    ceu.sun_elevation = math.radians(22)  # sol baixo de fim de tarde
    ceu.sun_rotation = math.radians(250)
    ceu.sun_disc = False
    mundo.node_tree.links.new(ceu.outputs["Color"], mundo.node_tree.nodes["Background"].inputs["Color"])
    sol = bpy.data.objects.new("sol", bpy.data.lights.new("sol", "SUN"))
    sol.data.energy = 2.6
    sol.data.angle = math.radians(2.0)
    sol.data.color = (1.0, 0.92, 0.78)  # luz quente de fim de tarde
    sol.rotation_euler = (math.radians(68), 0, math.radians(250))
    cena.collection.objects.link(sol)

    # bake de AO (independe de luz: sol e céu não importam aqui)
    img_ao = imagem_de_bake("ao", a.largura)
    nodes_ao = preparar_nodes_de_bake(malhas, img_ao)
    bake(cena, "AO", cor=False)
    remover_nodes_de_bake(nodes_ao)
    img_ao.filepath_raw = str(saida / "ao.png")
    img_ao.file_format = "PNG"
    img_ao.save()

    # bake de dia: luz direta + indireta do sol/céu, sem a cor do material (a textura de cor já existe à parte)
    img_dia = imagem_de_bake("dia", a.largura)
    nodes_dia = preparar_nodes_de_bake(malhas, img_dia)
    bake(cena, "DIFFUSE", cor=False)
    remover_nodes_de_bake(nodes_dia)
    img_dia.filepath_raw = str(saida / "dia.png")
    img_dia.file_format = "PNG"
    img_dia.save()

    # bake de noite: sol apagado, janelas/postes acesos (emissivos)
    sol.data.energy = 0.0
    mundo.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.02
    alterados = luzes_de_noite(malhas)
    img_noite = imagem_de_bake("noite", a.largura)
    nodes_noite = preparar_nodes_de_bake(malhas, img_noite)
    bake(cena, "DIFFUSE", cor=False)
    remover_nodes_de_bake(nodes_noite)
    restaurar_noite(alterados)
    img_noite.filepath_raw = str(saida / "noite.png")
    img_noite.file_format = "PNG"
    img_noite.save()

    # volta o sol e o céu de dia para exportar o modelo "normal" (o bake fica só nas 3 texturas, não na cena)
    sol.hide_render = True
    bpy.data.worlds.remove(mundo)

    bpy.ops.export_scene.gltf(filepath=str(saida / "baseline.glb"), export_format="GLB")
    (saida / "bake.json").write_text(json.dumps({"largura": a.largura, "dispositivo": dispositivo, "raio": raio}), encoding="utf-8")


main()
