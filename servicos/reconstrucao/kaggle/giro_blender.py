"""Roda DENTRO do Blender (4.2 LTS): blender -b -P giro_blender.py -- --glb modelo.glb --saida pasta --unidades nos.json

Giro 360° pré-renderizado do prédio (Blender Cycles, na GPU se houver):
- quadros coloridos (JPEG): luz do sol + céu físico (Nishita), chão claro, sombras e reflexos reais;
- máscaras (PNG): cada unidade pintada com a cor-ID do índice dela (mesma regra de `corDoIndice` do visualizador:
  v = índice + 1 → (v >> 16, v >> 8 & 255, v & 255)); o resto em preto;
- giro.json com quadros, tamanho, dispositivo e os nós das unidades (na ordem dos índices).
A câmera percorre a mesma órbita do giro feito no navegador (30° de elevação, prédio inteiro enquadrado).

Unidade = nó do glTF (`mesh_node_id`). O Blender pode trocar o nome do objeto (limite de 63 bytes, nomes
repetidos viram ".001"), então o nome original do nó vai antes para um extra (`imersa_no`), que o importador
guarda como propriedade do objeto.
"""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

CHAVE_NO = "imersa_no"


def argumentos():
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True)
    p.add_argument("--saida", required=True)
    p.add_argument("--unidades", required=True, help="JSON: lista de nomes de nó (na ordem dos índices)")
    p.add_argument("--quadros", type=int, default=72)
    p.add_argument("--largura", type=int, default=1280)
    p.add_argument("--altura", type=int, default=720)
    p.add_argument("--amostras", type=int, default=96)
    p.add_argument("--elevacao", type=float, default=30.0)
    p.add_argument("--gpu", action="store_true")
    p.add_argument("--so-mascaras", action="store_true", help="teste: pula os quadros coloridos")
    return p.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def cor_do_indice(i: int) -> tuple[float, float, float]:
    v = i + 1
    return ((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255


def marcar_nos(origem: Path, destino: Path) -> None:
    """Cópia do GLB com o nome de cada nó também em extras[imersa_no] (sobrevive ao renomear do Blender)."""
    dados = origem.read_bytes()
    if dados[:4] != b"glTF":
        raise SystemExit("o modelo não é um GLB")
    tam_json = struct.unpack_from("<I", dados, 12)[0]
    doc = json.loads(dados[20 : 20 + tam_json])
    resto = dados[20 + tam_json :]
    for no in doc.get("nodes", []):
        if no.get("name"):
            extras = no.get("extras") if isinstance(no.get("extras"), dict) else {}
            no["extras"] = {**extras, CHAVE_NO: no["name"]}
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    corpo = struct.pack("<II", len(js), 0x4E4F534A) + js + resto
    destino.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + len(corpo)) + corpo)


def material_emissao(nome: str, cor: tuple[float, float, float]):
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    em = n.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*cor, 1.0)
    em.inputs["Strength"].default_value = 1.0
    out = n.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def trocar_material(o, m) -> None:
    """Material preso ao objeto, não à malha: peças repetidas dividem a mesma malha (trocar nela trocaria em todas)."""
    if not o.material_slots:
        o.data.materials.append(None)
    for slot in o.material_slots:
        slot.link = "OBJECT"
        slot.material = m


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


def main() -> None:
    a = argumentos()
    saida = Path(a.saida)
    saida.mkdir(parents=True, exist_ok=True)
    nos: list[str] = json.loads(Path(a.unidades).read_text(encoding="utf-8"))
    indice = {nome: i for i, nome in enumerate(nos)}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    marcado = saida / "_modelo.glb"
    marcar_nos(Path(a.glb), marcado)
    bpy.ops.import_scene.gltf(filepath=str(marcado))
    marcado.unlink()
    cena = bpy.context.scene
    malhas = [o for o in cena.objects if o.type == "MESH"]
    no_de = {o: o.get(CHAVE_NO, o.name) for o in malhas}
    ambientes = [o for o in malhas if o.get("ifc") == "IfcSpace"]
    # ambiente (IfcSpace) é volume de ar: não aparece na imagem colorida
    for o in ambientes:
        o.hide_render = True
    visiveis = [o for o in malhas if not o.hide_render]
    if not visiveis:
        raise SystemExit("modelo sem peças visíveis")

    # caixa do prédio no mundo
    pts = [o.matrix_world @ Vector(c) for o in visiveis for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centro = (mn + mx) / 2
    raio = max((mx - mn).length / 2, 0.5)

    # chão, céu e sol (Blender é Z para cima; o importador glTF já converte)
    bpy.ops.mesh.primitive_plane_add(size=raio * 40, location=(centro.x, centro.y, mn.z - 0.01))
    chao = bpy.context.object
    mat_chao = bpy.data.materials.new("chao")
    mat_chao.use_nodes = True
    bsdf = mat_chao.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.3, 0.29, 0.27, 1)
    bsdf.inputs["Roughness"].default_value = 0.9
    chao.data.materials.append(mat_chao)
    mundo = bpy.data.worlds.new("ceu")
    cena.world = mundo
    mundo.use_nodes = True
    ceu = mundo.node_tree.nodes.new("ShaderNodeTexSky")
    ceu.sky_type = "NISHITA"
    ceu.sun_elevation = math.radians(40)
    ceu.sun_rotation = math.radians(135)
    ceu.sun_disc = False  # o sol (luz e sombra) é a lâmpada abaixo; com o disco do céu seriam dois sóis
    fundo = mundo.node_tree.nodes["Background"]
    fundo.inputs["Strength"].default_value = 0.5
    mundo.node_tree.links.new(ceu.outputs["Color"], fundo.inputs["Color"])
    sol = bpy.data.objects.new("sol", bpy.data.lights.new("sol", "SUN"))
    sol.data.energy = 3.0
    sol.data.angle = math.radians(1.5)
    sol.rotation_euler = (math.radians(50), 0, math.radians(135))
    cena.collection.objects.link(sol)

    cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle = math.radians(50)
    cam.data.clip_start = max(raio / 1000, 0.01)
    cam.data.clip_end = raio * 100
    cena.collection.objects.link(cam)
    cena.camera = cam
    alvo = bpy.data.objects.new("alvo", None)
    alvo.location = centro
    cena.collection.objects.link(alvo)
    restr = cam.constraints.new("TRACK_TO")
    restr.target = alvo
    restr.track_axis = "TRACK_NEGATIVE_Z"
    restr.up_axis = "UP_Y"
    el = math.radians(a.elevacao)

    def direcao(q: int) -> Vector:
        # mesma órbita do navegador; three.js (Y para cima) → Blender (Z para cima): (x, y, z) vira (x, -z, y)
        ang = math.radians(45) + q / a.quadros * 2 * math.pi
        return Vector((math.sin(ang) * math.cos(el), -math.cos(ang) * math.cos(el), math.sin(el)))

    # distância única que deixa os 8 cantos do prédio dentro da imagem em todos os quadros (com margem). Câmera em
    # centro + d·dir olhando para o centro: um canto p fica dentro se |x| ≤ tan(meio campo)·(d − rel·dir), ou seja,
    # d ≥ |x|/tan + rel·dir (x e y nos eixos da câmera, que não dependem de d).
    tan_v = math.tan(cam.data.angle / 2) * 0.9
    tan_h = tan_v * a.largura / a.altura
    cantos = [Vector((x, y, z)) - centro for x in (mn.x, mx.x) for y in (mn.y, mx.y) for z in (mn.z, mx.z)]
    distancia = 0.0
    for q in range(a.quadros):
        d = direcao(q)
        frente = -d
        direita = frente.cross(Vector((0, 0, 1))).normalized()
        cima = direita.cross(frente)
        for c in cantos:
            distancia = max(distancia, abs(c.dot(direita)) / tan_h + c.dot(d), abs(c.dot(cima)) / tan_v + c.dot(d))
    distancia = max(distancia, raio * 1.05)

    def posicionar(q: int) -> None:
        cam.location = centro + direcao(q) * distancia

    cena.render.engine = "CYCLES"
    dispositivo = ligar_gpu(cena) if a.gpu else "CPU"
    cena.render.resolution_x, cena.render.resolution_y = a.largura, a.altura
    cena.render.resolution_percentage = 100
    cena.render.use_persistent_data = True
    # sem metadados (data, nome da cena...) nas imagens: arquivos menores
    for campo in dir(cena.render):
        if campo.startswith("use_stamp_"):
            setattr(cena.render, campo, False)

    # 1) quadros coloridos
    if not a.so_mascaras:
        cena.cycles.samples = a.amostras
        cena.cycles.use_denoising = True
        cena.view_settings.view_transform = "AgX"
        try:
            cena.view_settings.look = "AgX - Medium High Contrast"
        except TypeError:  # nome do ajuste mudou em outra versão do Blender: fica o padrão
            pass
        cena.render.image_settings.file_format = "JPEG"
        cena.render.image_settings.quality = 88
        for q in range(a.quadros):
            posicionar(q)
            cena.render.filepath = str(saida / f"cor_{q:03d}.jpg")
            bpy.ops.render.render(write_still=True)

    # 2) máscaras: emissão pura, 1 amostra, sem filtro, sem pontilhado e sem transformação de cor (cada pixel com
    #    a cor-ID exata). Com ambientes ligados a unidades (BIM), só os ambientes entram: tocar na fachada pega o
    #    apartamento logo atrás dela; corredores e escadas (ambientes sem unidade) ficam pretos e tampam o que está
    #    atrás. Sem ambientes ligados, as peças sem unidade ficam pretas na frente.
    preto = material_emissao("mascara_preto", (0, 0, 0))
    com_ambiente = any(no_de[o] in indice for o in ambientes)
    for o in malhas:
        i = indice.get(no_de[o])
        if i is not None:
            o.hide_render = False
            trocar_material(o, material_emissao(f"id_{i}", cor_do_indice(i)))
        elif o in ambientes:
            o.hide_render = not com_ambiente
            trocar_material(o, preto)
        else:
            o.hide_render = com_ambiente
            trocar_material(o, preto)
    chao.hide_render = True
    sol.hide_render = True
    fundo.inputs["Strength"].default_value = 0.0
    cena.render.use_persistent_data = False
    cena.cycles.samples = 1
    cena.cycles.use_adaptive_sampling = False
    cena.cycles.use_denoising = False
    cena.cycles.filter_width = 0.01
    cena.cycles.max_bounces = 0
    cena.render.dither_intensity = 0.0
    cena.view_settings.view_transform = "Raw"
    cena.view_settings.look = "None"
    cena.view_settings.exposure = 0.0
    cena.view_settings.gamma = 1.0
    cena.render.image_settings.file_format = "PNG"
    cena.render.image_settings.color_mode = "RGB"
    cena.render.image_settings.color_depth = "8"
    cena.render.image_settings.compression = 90
    for q in range(a.quadros):
        posicionar(q)
        cena.render.filepath = str(saida / f"mascara_{q:03d}.png")
        bpy.ops.render.render(write_still=True)

    encontrados = sorted({no_de[o] for o in malhas if no_de[o] in indice})
    (saida / "giro.json").write_text(
        json.dumps(
            {
                "quadros": a.quadros,
                "largura": a.largura,
                "altura": a.altura,
                "nos": nos,
                "nos_sem_peca": [n for n in nos if n not in encontrados],
                "amostras": a.amostras,
                "dispositivo": dispositivo,
            }
        ),
        encoding="utf-8",
    )


main()
