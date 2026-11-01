"""
Vídeo de marketing do prédio na GPU gratuita do Kaggle (Blender Cycles; o Blender também codifica o MP4).

Entrada (dataset privado anexado ao notebook, montado em /kaggle/input/<dataset>/):
  modelo.glb        modelo 3D do prédio, já sem compressão (o importador do Blender não lê Meshopt)
  video_blender.py  o roteiro que roda dentro do Blender
  narracao.py       a locução (Kokoro-82M em ONNX, Apache-2.0) e a legenda, quando pedidas
  config.json       {"formato": "9:16", "segundos": 10, "fps": 30, "amostras": 48, "selo": "Imagem ilustrativa",
                     "narracao": {"texto": "...", "voz": "pf_dora"}}   (narracao é opcional)

Saída (/kaggle/working/, baixada pelo orquestrador):
  video.mp4, capa.jpg, video.json
  resultado.json    etapa, mensagem, dispositivo e tempos
"""

import json
import os
import subprocess
import sys
import shutil
import tarfile
import time
import urllib.request
from pathlib import Path

#: Blender 4.2 LTS (GPL; usado só como programa, nada dele vai para o produto)
BLENDER_URL = "https://download.blender.org/release/Blender4.2/blender-4.2.23-linux-x64.tar.xz"
INICIO = time.time()
SAIDA = Path("/kaggle/working")
TEMP = Path("/tmp/imersa-video")
RESULTADO: dict = {"etapa": "preparando", "tempos_s": {}}


def gravar(**mudancas) -> None:
    RESULTADO.update(mudancas)
    RESULTADO["decorrido_s"] = round(time.time() - INICIO, 1)
    (SAIDA / "resultado.json").write_text(json.dumps(RESULTADO, ensure_ascii=False, indent=2))
    print("[imersa]", json.dumps({k: v for k, v in RESULTADO.items() if k != "tempos_s"}, ensure_ascii=False), flush=True)


def falhar(codigo: str, mensagem: str) -> None:
    gravar(etapa="erro", erro=codigo, mensagem=mensagem)
    sys.exit(0)  # sai "com sucesso" para o Kaggle guardar o resultado.json


def achar_entrada() -> Path:
    for arquivo in Path("/kaggle/input").rglob("video_blender.py"):
        if (arquivo.parent / "modelo.glb").is_file():
            return arquivo.parent
    falhar("entrada_ausente", "Dataset de entrada não encontrado (precisa de modelo.glb e video_blender.py).")
    raise SystemExit


def tem_gpu() -> bool:
    try:
        return subprocess.run(["nvidia-smi", "-L"], capture_output=True, timeout=60).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def baixar_blender() -> Path:
    TEMP.mkdir(parents=True, exist_ok=True)
    pacote = TEMP / "blender.tar.xz"
    for tentativa in range(3):
        try:
            urllib.request.urlretrieve(BLENDER_URL, pacote)
            break
        except OSError:
            if tentativa == 2:
                falhar("sem_internet", "Não foi possível baixar o Blender. Confirme o celular na conta do Kaggle (libera a internet dos notebooks).")
            time.sleep(20)
    with tarfile.open(pacote) as t:
        try:
            t.extractall(TEMP, filter="data")
        except TypeError:  # Python sem o filtro (anterior a 3.11.4)
            t.extractall(TEMP)
    pacote.unlink()
    exe = next(TEMP.glob("blender-*/blender"))
    if subprocess.run([str(exe), "-b", "--factory-startup", "--version"], capture_output=True).returncode != 0:
        # imagem sem as bibliotecas de janela que o Blender carrega mesmo sem tela
        subprocess.run(["apt-get", "update", "-qq"], capture_output=True)
        libs = ["libxi6", "libxxf86vm1", "libxfixes3", "libxrender1", "libgl1", "libxkbcommon0", "libsm6", "libice6", "libegl1"]
        subprocess.run(["apt-get", "install", "-y", "-qq", *libs], capture_output=True)
    return exe


def narrar(entrada: Path, pasta: Path, pedido: dict) -> None:
    """Kokoro (voz em português) + legenda no vídeo do Blender."""
    try:
        # kokoro-onnx: o mesmo modelo em ONNX (o pacote em PyTorch não instala no Python 3.13 do Kaggle); traz o espeak-ng
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "kokoro-onnx>=0.4", "soundfile"], capture_output=True, timeout=1200, check=True)
    except (OSError, subprocess.SubprocessError) as e:
        falhar("falha_na_narracao", f"Não foi possível instalar a narração (Kokoro): {e}"[:300])
    sys.path.insert(0, str(entrada))
    import narracao  # o mesmo módulo do serviço (vem no dataset)

    try:
        info = narracao.narrar_video(pasta / "video.mp4", pedido["texto"], pedido["voz"], TEMP / "narracao")
    except Exception as e:  # noqa: BLE001 - qualquer falha da locução vira mensagem para a tela
        falhar("falha_na_narracao", f"A narração não foi gerada: {e}"[:300])
        raise
    arquivo = pasta / "video.json"
    arquivo.write_text(json.dumps({**json.loads(arquivo.read_text()), "narracao": info}, ensure_ascii=False))
    print("[imersa] narração:", json.dumps(info, ensure_ascii=False), flush=True)


def principal() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    entrada = achar_entrada()
    config = json.loads((entrada / "config.json").read_text())
    if not tem_gpu():
        falhar(
            "sem_gpu",
            "O notebook rodou sem GPU. Na conta do Kaggle, confirme o celular (Settings → Phone Verification): "
            "é o que libera a GPU gratuita e a internet dos notebooks.",
        )
    gravar(etapa="baixando_blender")
    t0 = time.time()
    blender = baixar_blender()
    RESULTADO["tempos_s"]["blender"] = round(time.time() - t0, 1)

    gravar(etapa="renderizando")
    pasta = TEMP / "video"
    t0 = time.time()
    comando = [
        str(blender), "-b", "--factory-startup", "-noaudio", "-P", str(entrada / "video_blender.py"), "--",
        "--glb", str(entrada / "modelo.glb"), "--saida", str(pasta), "--formato", config["formato"],
        "--segundos", str(config["segundos"]), "--fps", str(config["fps"]), "--amostras", str(config["amostras"]),
        "--selo", config["selo"], "--gpu",
    ]  # fmt: skip
    r = subprocess.run(comando, capture_output=True, text=True, env={**os.environ, "PYTHONUNBUFFERED": "1"})
    RESULTADO["tempos_s"]["render"] = round(time.time() - t0, 1)
    if r.returncode != 0 or not (pasta / "video.json").exists() or not (pasta / "video.mp4").exists():
        print((r.stdout or "")[-4000:], (r.stderr or "")[-4000:], flush=True)
        falhar("falha_no_render", "O Blender não terminou o vídeo. " + ((r.stderr or r.stdout or "").strip().splitlines() or [""])[-1][:300])
    if config.get("narracao"):
        gravar(etapa="narrando")
        t0 = time.time()
        narrar(entrada, pasta, config["narracao"])
        RESULTADO["tempos_s"]["narracao"] = round(time.time() - t0, 1)
    for nome in ("video.mp4", "capa.jpg", "video.json"):
        shutil.copy(pasta / nome, SAIDA / nome)
    info = json.loads((pasta / "video.json").read_text())
    gravar(etapa="pronto", dispositivo=info["dispositivo"], formato=info["formato"], segundos=info["segundos"], mb=round((SAIDA / "video.mp4").stat().st_size / 2**20, 2))


if __name__ == "__main__":
    principal()
