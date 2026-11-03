"""Roda DENTRO do Blender (4.2 LTS): blender -b -P bake_blender.py -- --glb modelo.glb --saida pasta

Luz pré-calculada do prédio (Plano 12a, item 6): bake no Cycles, na GPU se houver, de:
- UV2 (`TEXCOORD_1`) por "lightmap pack" (uma UV só para o prédio inteiro, sem sobreposição entre peças) —
  é nela que as 3 texturas abaixo são lidas;
- oclusão ambiente (AO), em `ao.png`;
- luz difusa de dia (céu físico Nishita, sol às 16h30 — mesma hora de abertura padrão do Plano 12a, item 7),
  em `dia.png`;
- luz difusa de noite (sol apagado; janelas e postes — objetos/materiais com "janela", "poste" ou "luz" no
  nome, ou peças IfcWindow do BIM, só o vidro — como emissivos), em `noite.png`.
O bake de dia/noite usa as passagens direta + indireta + emissão (sem a cor do material): é luz pura, pensada
para multiplicar/somar no shader por cima da cor normal (ver `packages/viewer/src/bake/lightmap.ts`). Cada
textura passa por um denoise (OpenImageDenoise, via compositor) antes de salvar — o bake do Cycles não
denoisa sozinho.

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
    # poucas amostras + denoise do compositor (ver `denoise_imagem`): mais barato que estourar amostras
    p.add_argument("--amostras", type=int, default=64)
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


def criar_uv2(malhas: list, largura: int, margem_px: int = 4) -> None:
    """UV2 (lightmap) para o prédio inteiro, num atlas só, sem peças se sobrepondo (bake não mistura unidades).

    `uv.lightmap_pack` (usado antes) caixa cada ilha separadamente e, neste tipo de malha (muitas peças
    pequenas vindas do IFC), estourava em milhares de ilhas minúsculas — atlas quase todo preto e luz
    granulada. Aqui: 1) `smart_project` por conectividade da malha (ilhas por face coplanar, não por
    triângulo solto); 2) `average_islands_scale` iguala a densidade de texel (m² de parede não fica do
    tamanho de um m² de batente de janela); 3) `pack_islands` arruma tudo num atlas só, girando ilha quando
    ajuda e com margem em pixels real (não proporcional ao tamanho da ilha).
    """
    bpy.ops.object.select_all(action="DESELECT")
    for o in malhas:
        o.select_set(True)
    bpy.context.view_layer.objects.active = malhas[0]
    for o in malhas:
        # o GLB do BIM não tem UV nenhuma: sem uma UV base, o lightmap seria exportado como TEXCOORD_0, e o
        # occlusionTexture/viewer leem o canal 1. Uma UV base (vazia de sentido) garante lightmap = TEXCOORD_1.
        if UV_LIGHTMAP not in o.data.uv_layers and len(o.data.uv_layers) == 0:
            o.data.uv_layers.new(name="UVMap")
        if UV_LIGHTMAP not in o.data.uv_layers:
            o.data.uv_layers.new(name=UV_LIGHTMAP)
        o.data.uv_layers[UV_LIGHTMAP].active = True
        o.data.uv_layers[UV_LIGHTMAP].active_render = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=max(margem_px, 1) / largura, margin_method="FRACTION")
    bpy.ops.object.mode_set(mode="OBJECT")


def imagem_de_bake(nome: str, largura: int):
    img = bpy.data.images.new(nome, width=largura, height=largura, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if nome == "ao" else "sRGB"
    return img


def salvar_denoised(cena, img, destino: Path) -> None:
    """Passa a imagem assada pelo nó Denoise (OpenImageDenoise) do compositor e já salva o PNG final.

    O bake do Cycles (`bpy.ops.object.bake`) não tem denoise nativo (só o render normal tem) — por isso
    menos amostras ficam granuladas. Aqui é um compositor "solto", sem Render Layers: entra a imagem assada,
    sai denoised. Salva direto pelo pipeline de render (com `color_management=OVERRIDE`) para não passar pela
    curva de visualização da cena (senão a imagem "Non-Color" do AO saía com gama errado).
    """
    cena.use_nodes = True
    nt = cena.node_tree
    nt.nodes.clear()
    n_img = nt.nodes.new("CompositorNodeImage")
    n_img.image = img
    n_den = nt.nodes.new("CompositorNodeDenoise")
    n_out = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(n_img.outputs["Image"], n_den.inputs["Image"])
    nt.links.new(n_den.outputs["Image"], n_out.inputs["Image"])

    cena.render.resolution_x, cena.render.resolution_y = img.size[0], img.size[1]
    cena.render.resolution_percentage = 100
    ie = cena.render.image_settings
    ie.file_format = "PNG"
    ie.color_management = "OVERRIDE"
    ie.linear_colorspace_settings.name = img.colorspace_settings.name
    cena.render.filepath = str(destino)
    bpy.ops.render.render(write_still=True)
    cena.use_nodes = False


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


def _principal_do_material(m):
    """Nó principal (Principled BSDF, normalmente) ligado na saída do material, ou None."""
    nt = m.node_tree
    saida = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if saida is None or not saida.inputs["Surface"].links:
        return None
    principal = saida.inputs["Surface"].links[0].from_node
    return principal if "Emission Strength" in getattr(principal, "inputs", {}) else None


def eh_luz(o) -> bool:
    """Peça que acende à noite: "janela"/"poste"/"luz" no nome ou, no modelo do BIM (nomes são GUIDs), IfcWindow."""
    return bool(PADRAO_LUZ.search(o.name)) or o.get("ifc") == "IfcWindow"


def _alfa(m) -> float:
    p = _principal_do_material(m)
    return p.inputs["Alpha"].default_value if p is not None and "Alpha" in p.inputs else 1.0


def isolar_materiais_das_luzes(malhas: list) -> list:
    """Cada peça que acende ganha cópia própria dos materiais que vão brilhar: no IFC o mesmo material costuma
    servir a janela e a parede, e acender o original acenderia a parede também. Devolve (slot, original) para
    `devolver_materiais` desfazer antes de exportar. Na janela do IFC só o vidro (material translúcido) brilha;
    sem vidro, a peça inteira."""
    trocas = []
    for o in malhas:
        if not eh_luz(o):
            continue
        slots = [s for s in o.material_slots if s.material is not None]
        vidros = [s for s in slots if _alfa(s.material) < 0.99]
        for slot in vidros or slots:
            trocas.append((slot, slot.material))
            slot.material = slot.material.copy()
            slot.material["imersa_luz"] = True
    return trocas


def devolver_materiais(trocas: list) -> None:
    for slot, original in trocas:
        copia = slot.material
        slot.material = original
        if copia is not None and copia.users == 0:
            bpy.data.materials.remove(copia)


def luzes_de_noite(malhas: list) -> list:
    """Os materiais marcados por `isolar_materiais_das_luzes` (ou com "janela"/"poste"/"luz" no nome) ganham um
    Emission forte."""
    alterados = []
    for o in malhas:
        for slot in o.material_slots:
            m = slot.material
            if m is None or not (m.get("imersa_luz") or PADRAO_LUZ.search(m.name)):
                continue
            principal = _principal_do_material(m)
            if principal is None:
                continue
            antes = principal.inputs["Emission Strength"].default_value
            antes_cor = tuple(principal.inputs["Emission Color"].default_value) if "Emission Color" in principal.inputs else None
            principal.inputs["Emission Strength"].default_value = max(antes, 1.0) * 6.0
            if antes_cor:
                principal.inputs["Emission Color"].default_value = (1.0, 0.85, 0.55, 1.0)  # luz amarelada
            alterados.append((principal, antes, antes_cor))
    return alterados


def apagar_emissao_dos_outros(malhas: list) -> list:
    """Zera a emissão de todo material SEM "janela"/"poste"/"luz" no nome, antes do bake de noite.

    Alguns conversores de IFC/BIM gravam um valor de emissão "de fábrica" no material (truque antigo pra
    simular luz ambiente em visualizador sem PBR de verdade) — sem isso, telhado/parede apareciam acesos
    à noite mesmo sem sol, sem luzes e sem bater na regra de "janela"/"poste"/"luz".
    """
    alterados = []
    vistos = set()
    for o in malhas:
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.get("imersa_luz") or PADRAO_LUZ.search(m.name) or m.name in vistos:
                continue
            vistos.add(m.name)
            principal = _principal_do_material(m)
            if principal is None or principal.inputs["Emission Strength"].default_value == 0:
                continue
            antes = principal.inputs["Emission Strength"].default_value
            antes_cor = tuple(principal.inputs["Emission Color"].default_value) if "Emission Color" in principal.inputs else None
            principal.inputs["Emission Strength"].default_value = 0.0
            alterados.append((principal, antes, antes_cor))
    return alterados


def restaurar_noite(alterados: list) -> None:
    for principal, antes, antes_cor in alterados:
        principal.inputs["Emission Strength"].default_value = antes
        if antes_cor:
            principal.inputs["Emission Color"].default_value = antes_cor


def bake(cena, tipo: str, cor: bool, margem_px: int) -> None:
    cena.cycles.bake_type = tipo
    # chamado por Python (fora do painel de Bake): o operador não lê `scene.render.bake.use_pass_*` por conta
    # própria, então o filtro de passagem precisa vir explícito no `pass_filter` (senão o bake sai todo preto).
    pass_filter: set[str] = set()
    if tipo == "COMBINED":
        # COMBINED (não DIFFUSE) para incluir a passagem EMIT: senão a própria janela/poste emissivo sai
        # preta no lightmap de noite (o bake DIFFUSE só pega luz refletida, nunca a emissão da própria face).
        cena.render.bake.use_pass_direct = True
        cena.render.bake.use_pass_indirect = True
        cena.render.bake.use_pass_diffuse = True
        cena.render.bake.use_pass_glossy = False
        cena.render.bake.use_pass_transmission = False
        cena.render.bake.use_pass_emit = True
        cena.render.bake.use_pass_color = cor
        pass_filter = {"DIFFUSE", "DIRECT", "INDIRECT", "EMIT"} | ({"COLOR"} if cor else set())
    # margem de dilatação (pixels fora da ilha que recebem a cor da borda): evita costura preta no mip/filtro
    bpy.ops.object.bake(type=tipo, pass_filter=pass_filter, margin=margem_px, margin_type="EXTEND", use_clear=True)


def main() -> None:
    a = argumentos()
    # absoluto: `scene.render.filepath` (usado em `salvar_denoised`) resolve caminho relativo contra a pasta
    # do .blend, que não existe aqui (cena nunca salva) — com caminho relativo o PNG ia parar na raiz do disco
    saida = Path(a.saida).resolve()
    saida.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a.glb)
    cena = bpy.context.scene
    # ambientes (ar) e vãos de abertura do IFC não são superfície: não ocupam o atlas nem fazem sombra
    malhas = [o for o in cena.objects if o.type == "MESH" and o.get("ifc") not in ("IfcSpace", "IfcOpeningElement")]
    if not malhas:
        raise SystemExit("modelo sem peças visíveis")

    pts = [o.matrix_world @ v.co for o in malhas for v in o.data.vertices]
    raio = max((max(p.x for p in pts) - min(p.x for p in pts)) / 2, (max(p.z for p in pts) - min(p.z for p in pts)) / 2, 0.5)

    # margem do atlas (gap entre ilhas no empacotamento) e margem de dilatação do bake (quanto a cor de cada
    # ilha "vaza" para fora dela): precisam ser parecidas — se o gap do atlas for menor que a dilatação do
    # bake, a dilatação de uma ilha grande invade a ilha vizinha pequena (ex.: engole a vidraça da janela).
    # Maior que antes (cada peça do IFC é um objeto/ilha separado: sem isso sobra costura preta fina nas
    # bordas, ex. moldura de janela, cumeeira do telhado, onde duas ilhas de objetos diferentes se encontram).
    margem_px = max(6, a.largura // 128)
    criar_uv2(malhas, a.largura, margem_px)

    cena.render.engine = "CYCLES"
    cena.cycles.samples = a.amostras
    # não afeta o bake (só o render normal tem denoise nativo); o denoise de verdade é `salvar_denoised`, abaixo
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
    bake(cena, "AO", cor=False, margem_px=margem_px)
    remover_nodes_de_bake(nodes_ao)
    salvar_denoised(cena, img_ao, saida / "ao.png")

    # bake de dia: luz direta + indireta do sol/céu + emissão (sem efeito de dia), sem a cor do material
    # (a textura de cor já existe à parte)
    img_dia = imagem_de_bake("dia", a.largura)
    nodes_dia = preparar_nodes_de_bake(malhas, img_dia)
    bake(cena, "COMBINED", cor=False, margem_px=margem_px)
    remover_nodes_de_bake(nodes_dia)
    salvar_denoised(cena, img_dia, saida / "dia.png")

    # bake de noite: sol apagado, janelas/postes acesos (emissivos) — COMBINED com EMIT para a própria janela
    # aparecer acesa no lightmap (DIFFUSE sozinho só pega luz refletida, nunca a emissão da própria face)
    sol.data.energy = 0.0
    mundo.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.02
    trocas = isolar_materiais_das_luzes(malhas)
    alterados = apagar_emissao_dos_outros(malhas) + luzes_de_noite(malhas)
    img_noite = imagem_de_bake("noite", a.largura)
    nodes_noite = preparar_nodes_de_bake(malhas, img_noite)
    bake(cena, "COMBINED", cor=False, margem_px=margem_px)
    remover_nodes_de_bake(nodes_noite)
    restaurar_noite(alterados)
    devolver_materiais(trocas)
    salvar_denoised(cena, img_noite, saida / "noite.png")

    # volta o sol e o céu de dia para exportar o modelo "normal" (o bake fica só nas 3 texturas, não na cena)
    sol.hide_render = True
    bpy.data.worlds.remove(mundo)

    bpy.ops.export_scene.gltf(filepath=str(saida / "baseline.glb"), export_format="GLB")
    (saida / "bake.json").write_text(json.dumps({"largura": a.largura, "dispositivo": dispositivo, "raio": raio}), encoding="utf-8")


main()
