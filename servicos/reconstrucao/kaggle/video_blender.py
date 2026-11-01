"""Roda DENTRO do Blender (4.2 LTS): blender -b -P video_blender.py -- --glb modelo.glb --saida pasta --formato 9:16

Vídeo de marketing do prédio, fiel ao projeto (é o modelo 3D de verdade, não uma imagem inventada):
- passeio de câmera cinematográfico: chegada do alto e de longe, contornando o prédio, terminando mais baixa e
  perto (movimento suave, sem tranco, com borrão de movimento como numa câmera real);
- Blender Cycles na GPU: céu físico (Nishita), sol com sombra, chão, AgX, redução de ruído;
- formatos 9:16 (Reels/Stories), 1:1 (feed/WhatsApp) e 16:9, em 1080p, 30 quadros por segundo;
- selo "Imagem ilustrativa" gravado em todos os quadros (obrigatório: não sai vídeo sem selo);
- codificado em H.264/MP4 pelo próprio Blender (o codificador dele é o ffmpeg) + capa (JPEG) + video.json.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

FORMATOS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}


def argumentos():
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True)
    p.add_argument("--saida", required=True)
    p.add_argument("--formato", choices=sorted(FORMATOS), required=True)
    p.add_argument("--segundos", type=float, default=10.0)
    p.add_argument("--fps", type=int, default=30)
    # 48 + amostragem adaptativa + redução de ruído: igual a 128 a olho (diferença média 0,09 em 255) e 2,2× mais rápido
    p.add_argument("--amostras", type=int, default=48)
    p.add_argument("--escala", type=int, default=100, help="% da resolução (testes)")
    p.add_argument("--selo", default="Imagem ilustrativa")
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


def suave(t: float) -> float:
    """Entrada e saída suaves (smootherstep): a câmera começa e para sem tranco."""
    t = min(1.0, max(0.0, t))
    return t * t * t * (t * (t * 6 - 15) + 10)


def pontos_do_contorno(cena, limite: int = 20000) -> list:
    """Vértices do prédio (no máximo `limite`, espaçados): o enquadramento usa a forma real, não a caixa em volta."""
    malhas = [o for o in cena.objects if o.type == "MESH" and not o.hide_render and o.name != "chao"]
    total = sum(len(o.data.vertices) for o in malhas)
    passo = max(1, total // limite)
    pts = [o.matrix_world @ o.data.vertices[i].co for o in malhas for i in range(0, len(o.data.vertices), passo)]
    return pts or [Vector((0, 0, 0))]


def montar_cena(glb: Path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    cena = bpy.context.scene
    malhas = [o for o in cena.objects if o.type == "MESH"]
    # ambiente (IfcSpace) é volume de ar: não aparece
    for o in malhas:
        if o.get("ifc") == "IfcSpace":
            o.hide_render = True
    visiveis = [o for o in malhas if not o.hide_render]
    if not visiveis:
        raise SystemExit("modelo sem peças visíveis")
    pts = [o.matrix_world @ Vector(c) for o in visiveis for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))

    raio = max((mx - mn).length / 2, 0.5)
    centro = (mn + mx) / 2
    bpy.ops.mesh.primitive_plane_add(size=raio * 400, location=(centro.x, centro.y, mn.z - 0.01))
    chao = bpy.context.object
    chao.name = "chao"
    mat = bpy.data.materials.new("chao")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.3, 0.29, 0.27, 1)
    bsdf.inputs["Roughness"].default_value = 0.85
    chao.data.materials.append(mat)
    mundo = bpy.data.worlds.new("ceu")
    cena.world = mundo
    mundo.use_nodes = True
    ceu = mundo.node_tree.nodes.new("ShaderNodeTexSky")
    ceu.sky_type = "NISHITA"
    ceu.sun_elevation = math.radians(38)
    ceu.sun_rotation = math.radians(135)
    ceu.sun_disc = False  # o sol (luz e sombra) é a lâmpada; com o disco do céu seriam dois sóis
    fundo = mundo.node_tree.nodes["Background"]
    fundo.inputs["Strength"].default_value = 0.5
    mundo.node_tree.links.new(ceu.outputs["Color"], fundo.inputs["Color"])
    sol = bpy.data.objects.new("sol", bpy.data.lights.new("sol", "SUN"))
    sol.data.energy = 3.0
    sol.data.angle = math.radians(1.5)
    sol.rotation_euler = (math.radians(52), 0, math.radians(135))
    cena.collection.objects.link(sol)
    return cena, mn, mx


def main() -> None:
    a = argumentos()
    saida = Path(a.saida)
    (saida / "quadros").mkdir(parents=True, exist_ok=True)
    largura, altura = FORMATOS[a.formato]
    cena, mn, mx = montar_cena(Path(a.glb))
    centro = (mn + mx) / 2
    alto = mx.z - mn.z

    cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    cam.data.lens = 24  # grande-angular de foto de arquitetura
    cam.data.sensor_width = 36
    cam.data.sensor_fit = "AUTO"
    raio = max((mx - mn).length / 2, 0.5)
    cam.data.clip_start = max(raio / 1000, 0.01)
    cam.data.clip_end = raio * 200
    cena.collection.objects.link(cam)
    cena.camera = cam

    # campo de visão: o ângulo da lente vale para o lado maior da imagem; o menor é proporcional
    tan_maior = (cam.data.sensor_width / 2) / cam.data.lens
    tan_h = tan_maior * (1 if largura >= altura else largura / altura) * 0.9
    tan_v = tan_maior * (1 if altura >= largura else altura / largura) * 0.9
    cantos = pontos_do_contorno(cena)

    total = max(2, round(a.segundos * a.fps))

    def pose(q: int):
        t = suave(q / (total - 1))
        ang = math.radians(-35 + 125 * t)  # contorna o prédio em 125°
        el = math.radians(36 - 22 * t)  # do alto (36°) para quase a altura dos olhos (14°)
        alvo = centro - Vector((0, 0, alto * 0.12 * t))  # no fim, olha um pouco mais para baixo: prédio imponente
        d = Vector((math.sin(ang) * math.cos(el), -math.cos(ang) * math.cos(el), math.sin(el)))
        frente = -d
        direita = frente.cross(Vector((0, 0, 1))).normalized()
        cima = direita.cross(frente)
        # menor distância em que o prédio inteiro cabe na imagem (com margem), nesta direção
        perto = max(max(abs((c - alvo).dot(direita)) / tan_h + (c - alvo).dot(d), abs((c - alvo).dot(cima)) / tan_v + (c - alvo).dot(d)) for c in cantos)
        perto = max(perto, raio * 1.05)
        return alvo + d * perto * (1.25 - 0.25 * t), alvo  # chega de mais longe e termina enquadrado bem perto

    cena.render.engine = "CYCLES"
    dispositivo = ligar_gpu(cena) if a.gpu else "CPU"
    cena.cycles.samples = a.amostras
    cena.cycles.use_denoising = True
    cena.cycles.denoiser = "OPENIMAGEDENOISE"
    if dispositivo != "CPU":
        # redução de ruído na placa de vídeo: na CPU fraca do Kaggle ela pesava em cada quadro de 2 megapixels
        try:
            cena.cycles.denoising_use_gpu = True
        except AttributeError:
            pass
    cena.render.use_motion_blur = True
    cena.render.motion_blur_shutter = 0.5
    cena.render.use_persistent_data = True
    cena.render.resolution_x, cena.render.resolution_y = largura, altura
    cena.render.resolution_percentage = a.escala
    cena.render.fps = a.fps
    cena.view_settings.view_transform = "AgX"
    try:
        cena.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    for campo in dir(cena.render):
        if campo.startswith("use_stamp_"):
            setattr(cena.render, campo, False)

    # animação por quadros-chave (o borrão de movimento precisa saber onde a câmera estava entre os quadros)
    alvo_obj = bpy.data.objects.new("alvo", None)
    cena.collection.objects.link(alvo_obj)
    restr = cam.constraints.new("TRACK_TO")
    restr.target = alvo_obj
    restr.track_axis = "TRACK_NEGATIVE_Z"
    restr.up_axis = "UP_Y"
    for q in range(total):
        pos, alvo = pose(q)
        cam.location = pos
        alvo_obj.location = alvo
        cam.keyframe_insert("location", frame=q + 1)
        alvo_obj.keyframe_insert("location", frame=q + 1)
    cena.frame_start, cena.frame_end = 1, total
    cena.render.image_settings.file_format = "PNG"
    cena.render.image_settings.color_mode = "RGB"
    cena.render.filepath = str(saida / "quadros" / "q_")
    bpy.ops.render.render(animation=True)

    # montagem: quadros + selo → MP4 (H.264, qualidade alta). O selo fica num canal acima, em todos os quadros.
    larg_final = largura * a.escala // 100
    alt_final = altura * a.escala // 100
    montagem = bpy.data.scenes.new("montagem")
    montagem.render.resolution_x, montagem.render.resolution_y = larg_final, alt_final
    montagem.render.resolution_percentage = 100
    montagem.render.fps = a.fps
    montagem.frame_start, montagem.frame_end = 1, total
    montagem.view_settings.view_transform = "Standard"  # os quadros já saíram com a cor final
    seq = montagem.sequence_editor_create()
    arquivos = sorted((saida / "quadros").glob("q_*.png"))
    if len(arquivos) != total:
        raise SystemExit(f"render incompleto: {len(arquivos)} de {total} quadros")
    imagens = seq.sequences.new_image("quadros", str(arquivos[0]), channel=1, frame_start=1)
    for f in arquivos[1:]:
        imagens.elements.append(f.name)
    selo = seq.sequences.new_effect("selo", "TEXT", channel=2, frame_start=1, frame_end=total + 1)
    selo.text = a.selo
    # fonte Inter (vem com o Blender): o padrão do editor de vídeo é monoespaçada
    inter = Path(bpy.utils.resource_path("LOCAL")) / "datafiles" / "fonts" / "Inter.woff2"
    if inter.exists():
        selo.font = bpy.data.fonts.load(str(inter))
    selo.font_size = max(12, round(alt_final * (0.022 if alt_final > larg_final else 0.03)))
    selo.color = (1, 1, 1, 1)
    selo.use_box = True
    selo.box_color = (0, 0, 0, 0.55)
    selo.box_margin = 0.012
    selo.use_shadow = False
    selo.align_x, selo.align_y = "LEFT", "BOTTOM"
    selo.location = (0.035, 0.03)
    montagem.render.image_settings.file_format = "FFMPEG"
    montagem.render.ffmpeg.format = "MPEG4"
    montagem.render.ffmpeg.codec = "H264"
    montagem.render.ffmpeg.constant_rate_factor = "HIGH"
    montagem.render.ffmpeg.ffmpeg_preset = "BEST"
    montagem.render.ffmpeg.gopsize = a.fps
    montagem.render.ffmpeg.audio_codec = "NONE"
    montagem.render.filepath = str(saida / "video.mp4")
    bpy.ops.render.render(animation=True, scene=montagem.name)

    # capa: um quadro perto do fim (a melhor pose), já com o selo
    montagem.render.image_settings.file_format = "JPEG"
    montagem.render.image_settings.quality = 90
    montagem.frame_set(max(1, int(total * 0.8)))
    montagem.render.filepath = str(saida / "capa.jpg")
    bpy.ops.render.render(write_still=True, scene=montagem.name)

    gerado = next(saida.glob("video*.mp4"), None)
    if not gerado:
        raise SystemExit("o vídeo não foi gravado")
    if gerado.name != "video.mp4":
        gerado.rename(saida / "video.mp4")
    (saida / "video.json").write_text(
        json.dumps(
            {
                "formato": a.formato,
                "largura": larg_final,
                "altura": alt_final,
                "fps": a.fps,
                "quadros": total,
                "segundos": round(total / a.fps, 2),
                "amostras": a.amostras,
                "selo": a.selo,
                "dispositivo": dispositivo,
            }
        ),
        encoding="utf-8",
    )


main()
