from pathlib import Path

import pytest

from imersa_recon.narracao import comando_mixar, dividir_frases, legendas_srt


def test_frases_da_locucao():
    texto = "Conheça o Residencial Paulista, em São Paulo.  Doze unidades disponíveis!\nAgende sua visita."
    assert dividir_frases(texto) == ["Conheça o Residencial Paulista, em São Paulo.", "Doze unidades disponíveis!", "Agende sua visita."]
    assert dividir_frases("   ") == []


def test_legenda_no_tempo_da_fala():
    srt = legendas_srt(["Primeira frase.", "Segunda."], [2.5, 1.25], pausa_s=0.25)
    assert srt.splitlines()[:3] == ["1", "00:00:00,000 --> 00:00:02,500", "Primeira frase."]
    assert "00:00:02,750 --> 00:00:04,000" in srt
    with pytest.raises(ValueError):
        legendas_srt(["a"], [1, 2])


def test_mixar_legenda_queimada_e_voz():
    cmd = comando_mixar(Path("v.mp4"), Path("n.wav"), Path("C:/x/legenda.srt"), Path("s.mp4"), video_s=10, audio_s=8)
    vf = cmd[cmd.index("-vf") + 1]
    assert "subtitles='C\:/x/legenda.srt'" in vf  # caminho escapado para o filtro do ffmpeg
    assert "tpad" not in vf  # a voz cabe no vídeo
    assert ["-c:a", "aac"] == cmd[cmd.index("-c:a") : cmd.index("-c:a") + 2]
    assert "-shortest" not in cmd  # nada da fala é cortado


def test_mixar_fala_maior_que_o_video_segura_o_ultimo_quadro():
    cmd = comando_mixar(Path("v.mp4"), Path("n.wav"), Path("l.srt"), Path("s.mp4"), video_s=10, audio_s=11)
    assert "tpad=stop_mode=clone:stop_duration=1.40" in cmd[cmd.index("-vf") + 1]


def test_mixar_sem_libass_vai_como_faixa_e_copia_o_video():
    cmd = comando_mixar(Path("v.mp4"), Path("n.wav"), Path("l.srt"), Path("s.mp4"), video_s=10, audio_s=8, queimar=False)
    assert "-vf" not in cmd
    assert ["-c:v", "copy"] == cmd[cmd.index("-c:v") : cmd.index("-c:v") + 2]
    assert "mov_text" in cmd
