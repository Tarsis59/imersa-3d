"""
Vídeo de marketing do prédio: GLB (sem compressão) → Blender Cycles na GPU gratuita do Kaggle → MP4 com o selo
"Imagem ilustrativa" + capa. O vídeo é o modelo 3D de verdade (passeio de câmera), não imagem gerada por IA.

  python -m imersa_recon.filme --glb modelo.glb --formato 9:16 --id 3f2a9c1e --saida pasta --resultado r.json
  python -m imersa_recon.filme ... --blender C:/blender/blender.exe      (roda no Blender local, sem Kaggle)

Usuário do Kaggle: --usuario ou a variável KAGGLE_USERNAME.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from .giro import _esperar
from .kaggle_cli import KaggleCli
from .pipeline import RAIZ, ErroPipeline, Nuvem

FORMATOS = ("9:16", "1:1", "16:9")
SELO = "Imagem ilustrativa"
PADRAO = {"segundos": 10.0, "fps": 30, "amostras": 48}
#: um vídeo de 10 s em 1080p fica em poucos MB; acima disso algo saiu errado
MAX_MB = 150


@dataclass
class TrabalhoVideo:
    id: str
    usuario: str
    pasta: Path
    intervalo_s: float = 30
    limite_s: float = 4 * 3600

    @property
    def id_dataset(self) -> str:
        return f"{self.usuario}/imersa-video-{self.id}"

    @property
    def id_kernel(self) -> str:
        # nome diferente do dataset: o Kaggle recusa (409) notebook com o mesmo nome de um dataset da conta
        return f"{self.usuario}/imersa-filme-{self.id}"


def preparar_dataset(glb: Path, config: dict, t: TrabalhoVideo) -> Path:
    destino = t.pasta / "dataset"
    if destino.exists():
        shutil.rmtree(destino)
    destino.mkdir(parents=True)
    shutil.copy(glb, destino / "modelo.glb")
    (destino / "config.json").write_text(json.dumps(config))
    shutil.copy(RAIZ / "kaggle" / "video_blender.py", destino / "video_blender.py")
    (destino / "dataset-metadata.json").write_text(
        json.dumps({"title": f"imersa-video-{t.id}", "id": t.id_dataset, "isPrivate": True, "licenses": [{"name": "other"}]})
    )
    return destino


def preparar_kernel(t: TrabalhoVideo) -> Path:
    destino = t.pasta / "kernel"
    destino.mkdir(parents=True, exist_ok=True)
    shutil.copy(RAIZ / "kaggle" / "video.py", destino / "video.py")
    meta = {
        "id": t.id_kernel,
        "title": f"imersa-filme-{t.id}",
        "code_file": "video.py",
        "language": "python",
        "kernel_type": "script",
        "is_private": True,
        "enable_gpu": True,
        "enable_tpu": False,
        "enable_internet": True,  # baixa o Blender
        "dataset_sources": [t.id_dataset],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }
    (destino / "kernel-metadata.json").write_text(json.dumps(meta, indent=2))
    return destino


def conferir_video(pasta: Path, config: dict) -> dict:
    """O vídeo tem de existir, ter o formato pedido e o selo (sem selo não sai vídeo)."""
    video, info_arq = pasta / "video.mp4", pasta / "video.json"
    if not video.exists() or not info_arq.exists():
        raise ErroPipeline("falha_na_gpu", "O render terminou sem o vídeo.")
    info = json.loads(info_arq.read_text(encoding="utf-8"))
    if info.get("selo") != SELO or info.get("formato") != config["formato"]:
        raise ErroPipeline("falha_na_gpu", "O vídeo saiu sem o selo ou em outro formato.")
    if video.read_bytes()[4:8] != b"ftyp":
        raise ErroPipeline("falha_na_gpu", "O arquivo do vídeo não é um MP4.")
    mb = video.stat().st_size / 2**20
    if mb > MAX_MB:
        raise ErroPipeline("video_grande_demais", f"O vídeo ficou com {mb:.0f} MB (máximo {MAX_MB}).")
    return {**info, "mb": round(mb, 2), "capa": (pasta / "capa.jpg").exists()}


def executar(glb: Path, config: dict, t: TrabalhoVideo, nuvem: Nuvem) -> tuple[Path, dict]:
    if glb.read_bytes()[:4] != b"glTF":
        raise ErroPipeline("modelo_invalido", "O modelo do prédio não é um GLB.")
    t.pasta.mkdir(parents=True, exist_ok=True)
    nuvem.criar_dataset(preparar_dataset(glb, config, t))
    _esperar(nuvem, t, preparar_kernel)  # mesmo acompanhamento do giro, com o notebook do vídeo
    saida = t.pasta / "saida"
    nuvem.baixar_saida(t.id_kernel, saida)
    arquivo = saida / "resultado.json"
    if not arquivo.exists():
        raise ErroPipeline("falha_na_gpu", "A nuvem terminou sem devolver o resultado.")
    resultado = json.loads(arquivo.read_text(encoding="utf-8"))
    if resultado.get("etapa") != "pronto":
        raise ErroPipeline(resultado.get("erro", "falha_na_gpu"), resultado.get("mensagem", "O render na nuvem não terminou."))
    return saida, {**conferir_video(saida, config), "tempos_s": resultado.get("tempos_s", {})}


def executar_local(glb: Path, config: dict, pasta: Path, blender: str, escala: int = 100) -> tuple[Path, dict]:
    """Mesmo render no Blender desta máquina (sem Kaggle): testes e quem tem placa de vídeo própria."""
    saida = pasta / "video"
    shutil.rmtree(saida, ignore_errors=True)
    comando = [
        blender, "-b", "--factory-startup", "-noaudio", "-P", str(RAIZ / "kaggle" / "video_blender.py"), "--",
        "--glb", str(glb), "--saida", str(saida), "--formato", config["formato"], "--segundos", str(config["segundos"]),
        "--fps", str(config["fps"]), "--amostras", str(config["amostras"]), "--selo", config["selo"], "--escala", str(escala), "--gpu",
    ]  # fmt: skip
    inicio = time.monotonic()
    r = subprocess.run(comando, capture_output=True, text=True)
    if r.returncode != 0:
        raise ErroPipeline("falha_no_render", "O Blender não terminou o vídeo.", (r.stderr or r.stdout or "").strip().splitlines()[-5:])
    return saida, {**conferir_video(saida, config), "tempos_s": {"render": round(time.monotonic() - inicio, 1)}}


def principal(argv: list[str] | None = None, nuvem: Nuvem | None = None) -> int:
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Vídeo de marketing (Blender Cycles) na GPU gratuita do Kaggle")
    p.add_argument("--glb", type=Path, required=True)
    p.add_argument("--formato", choices=FORMATOS, required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--saida", type=Path, required=True)
    p.add_argument("--resultado", type=Path)
    p.add_argument("--usuario", default=os.environ.get("KAGGLE_USERNAME"))
    p.add_argument("--blender", help="executável do Blender local (sem Kaggle)")
    p.add_argument("--escala", type=int, default=100, help="% da resolução (só no Blender local, para testes)")
    p.add_argument("--segundos", type=float, default=PADRAO["segundos"])
    p.add_argument("--fps", type=int, default=PADRAO["fps"])
    p.add_argument("--amostras", type=int, default=PADRAO["amostras"])
    a = p.parse_args(argv)
    if not re.fullmatch(r"[a-z0-9-]{4,40}", a.id):
        p.error("--id: só letras minúsculas, números e hífen (4 a 40)")
    if not a.blender and not a.usuario:
        p.error("informe --usuario (o nome de usuário do Kaggle) ou KAGGLE_USERNAME")

    def responder(dados: dict, codigo: int) -> int:
        texto = json.dumps(dados, ensure_ascii=False, indent=2)
        print(texto)
        if a.resultado:
            a.resultado.parent.mkdir(parents=True, exist_ok=True)
            a.resultado.write_text(texto, encoding="utf-8")
        return codigo

    config = {"formato": a.formato, "segundos": a.segundos, "fps": a.fps, "amostras": a.amostras, "selo": SELO}
    try:
        if a.blender:
            pasta, info = executar_local(a.glb, config, a.saida, a.blender, a.escala)
        else:
            if nuvem is None:
                nuvem = KaggleCli(shutil.which("kaggle") or str(Path(sys.executable).parent / "kaggle"))
            pasta, info = executar(a.glb, config, TrabalhoVideo(id=a.id, usuario=a.usuario, pasta=a.saida), nuvem)
    except OSError as e:
        return responder({"ok": False, "erro": "entrada_invalida", "mensagem": f"Entrada inválida: {e}", "detalhes": []}, 2)
    except ErroPipeline as e:
        return responder({"ok": False, "erro": e.codigo, "mensagem": str(e), "detalhes": e.detalhes}, 2)
    except RuntimeError as e:  # cliente do Kaggle recusou/caiu: transitório (o worker tenta de novo)
        return responder({"ok": False, "erro": "falha_na_gpu", "mensagem": str(e)[:500], "detalhes": []}, 2)
    capa = pasta / "capa.jpg"
    return responder({"ok": True, "video": str(pasta / "video.mp4"), "capa": str(capa) if capa.exists() else None, **info}, 0)


if __name__ == "__main__":
    sys.exit(principal())
