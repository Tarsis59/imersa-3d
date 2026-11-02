"""
Narração em português dos vídeos do estúdio: Kokoro-82M (modelo Apache-2.0, vozes pt-BR `pf_dora` e `pm_alex`) fala
o roteiro, e o ffmpeg junta a voz e a legenda ao vídeo do Blender (o selo "Imagem ilustrativa" continua na imagem).

Roda o modelo em ONNX pelo `kokoro-onnx` (MIT): funciona no Python 3.13 do Kaggle (o pacote `kokoro` em PyTorch não
instala lá) e em CPU, e já traz o espeak-ng (fonemas do português). Os arquivos do modelo (~330 MB) são baixados
uma vez para `KOKORO_PASTA` (padrão: ~/.cache/kokoro).
"""

import os
import re
import shutil
import subprocess
import urllib.request
from pathlib import Path

VOZES = ("pf_dora", "pm_alex")
TAXA = 24_000
#: arquivos do modelo (releases do kokoro-onnx, Apache-2.0)
MODELO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
ARQUIVOS_MODELO = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
#: respiro entre as frases da locução
PAUSA_S = 0.25


def dividir_frases(texto: str) -> list[str]:
    """Frases da locução (cada uma vira uma legenda)."""
    partes = re.split(r"(?<=[.!?])\s+", " ".join(texto.split()))
    return [p.strip() for p in partes if p.strip()]


def _tempo_srt(s: float) -> str:
    ms = int(round(s * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    seg, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{seg:02d},{ms:03d}"


def legendas_srt(frases: list[str], duracoes: list[float], pausa_s: float = PAUSA_S) -> str:
    """Legenda SRT com cada frase no tempo em que é falada."""
    if len(frases) != len(duracoes):
        raise ValueError("uma duração por frase")
    blocos, t = [], 0.0
    for i, (frase, d) in enumerate(zip(frases, duracoes), start=1):
        blocos.append(f"{i}\n{_tempo_srt(t)} --> {_tempo_srt(t + d)}\n{frase}\n")
        t += d + pausa_s
    return "\n".join(blocos)


def comando_mixar(video: Path, audio: Path, srt: Path, saida: Path, video_s: float, audio_s: float, queimar: bool = True) -> list[str]:
    """
    ffmpeg: voz em AAC e legenda. `queimar` desenha a legenda na imagem (aparece em qualquer rede social); senão vai
    como faixa de legenda. Se a locução for maior que o vídeo, o último quadro segura até ela terminar.
    """
    extra = max(0.0, audio_s + 0.4 - video_s)
    filtros = []
    if extra > 0:
        filtros.append(f"tpad=stop_mode=clone:stop_duration={extra:.2f}")
    if queimar:
        caminho = str(srt).replace("\\", "/").replace(":", "\\:")
        estilo = "FontName=DejaVu Sans,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=70"
        filtros.append(f"subtitles='{caminho}':force_style='{estilo}'")
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(video), "-i", str(audio)]
    if not queimar:
        cmd += ["-i", str(srt)]
    if filtros:
        cmd += ["-vf", ",".join(filtros), "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p"]
    else:
        cmd += ["-c:v", "copy"]
    cmd += ["-map", "0:v:0", "-map", "1:a:0"]
    if not queimar:
        cmd += ["-map", "2:s:0", "-c:s", "mov_text", "-metadata:s:s:0", "language=por"]
    cmd += ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(saida)]
    return cmd


def arquivos_do_modelo() -> tuple[Path, Path]:
    """O modelo e as vozes, baixados uma vez (download por arquivo temporário: interrompido não fica pela metade)."""
    pasta = Path(os.environ.get("KOKORO_PASTA", Path.home() / ".cache" / "kokoro"))
    pasta.mkdir(parents=True, exist_ok=True)
    for nome in ARQUIVOS_MODELO:
        destino = pasta / nome
        if not destino.exists():
            parcial = destino.with_suffix(destino.suffix + ".parcial")
            urllib.request.urlretrieve(MODELO_URL + nome, parcial)
            parcial.replace(destino)
    return pasta / ARQUIVOS_MODELO[0], pasta / ARQUIVOS_MODELO[1]


def sintetizar(texto: str, voz: str, pasta: Path) -> dict:
    """Kokoro fala frase por frase (o tempo de cada uma vira a legenda). Devolve o WAV, o SRT e a duração."""
    if voz not in VOZES:
        raise ValueError(f"voz desconhecida: {voz}")
    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    frases = dividir_frases(texto)
    if not frases:
        raise ValueError("roteiro vazio")
    modelo, vozes = arquivos_do_modelo()
    kokoro = Kokoro(str(modelo), str(vozes))
    pedacos, duracoes = [], []
    silencio = np.zeros(int(TAXA * PAUSA_S), dtype=np.float32)
    for frase in frases:
        audio, taxa = kokoro.create(frase, voice=voz, speed=1.0, lang="pt-br")  # português do Brasil
        if taxa != TAXA:
            raise RuntimeError(f"taxa inesperada do Kokoro: {taxa}")
        audio = np.asarray(audio, dtype=np.float32)
        duracoes.append(len(audio) / TAXA)
        pedacos += [audio, silencio]
    pasta.mkdir(parents=True, exist_ok=True)
    wav = pasta / "narracao.wav"
    sf.write(wav, np.concatenate(pedacos[:-1]), TAXA)
    srt = pasta / "legenda.srt"
    srt.write_text(legendas_srt(frases, duracoes), encoding="utf-8")
    return {"wav": wav, "srt": srt, "segundos": round(sum(duracoes) + PAUSA_S * (len(frases) - 1), 2), "frases": len(frases)}


def duracao_video(video: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(video)], capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def narrar_video(video: Path, texto: str, voz: str, pasta: Path) -> dict:
    """Vídeo do Blender + locução + legenda. Substitui o MP4. Legenda queimada; sem libass, vai como faixa."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg não encontrado")
    s = sintetizar(texto, voz, pasta)
    video_s = duracao_video(video)
    saida = pasta / "video-narrado.mp4"
    legenda = "queimada"
    r = subprocess.run(comando_mixar(video, s["wav"], s["srt"], saida, video_s, s["segundos"], queimar=True), capture_output=True, text=True)
    if r.returncode != 0:
        legenda = "faixa"  # ffmpeg sem libass: a legenda vai como faixa (players e WhatsApp mostram)
        subprocess.run(comando_mixar(video, s["wav"], s["srt"], saida, video_s, s["segundos"], queimar=False), capture_output=True, text=True, check=True)
    shutil.move(str(saida), str(video))
    shutil.copy(s["srt"], video.with_suffix(".srt"))
    return {"voz": voz, "segundos": s["segundos"], "frases": s["frases"], "legenda": legenda}
