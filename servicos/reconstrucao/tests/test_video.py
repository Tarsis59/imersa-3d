from pathlib import Path

import cv2
import numpy as np
import pytest

from imersa_recon.nitidez import nitidez
from imersa_recon.video import extrair_quadros

TREMIDOS = {3, 4, 5, 13, 14, 15, 23, 24, 25, 33, 34, 35, 43, 44, 45, 53, 54, 55}


@pytest.fixture
def video(tmp_path: Path) -> Path:
    """60 quadros 640x360 de uma cena andando; os quadros em TREMIDOS saem borrados."""
    caminho = tmp_path / "visita.avi"
    gravador = cv2.VideoWriter(str(caminho), cv2.VideoWriter_fourcc(*"MJPG"), 30, (640, 360))
    y, x = np.indices((360, 640))
    for i in range(60):
        cena = ((((x + i * 7) // 24 + y // 24) % 2) * 200 + 30).astype(np.uint8)
        quadro = cv2.cvtColor(cena, cv2.COLOR_GRAY2BGR)
        if i in TREMIDOS:
            quadro = cv2.GaussianBlur(quadro, (0, 0), 7)
        gravador.write(quadro)
    gravador.release()
    return caminho


def test_extrai_a_quantidade_pedida_sem_quadros_tremidos(video: Path, tmp_path: Path):
    saida = tmp_path / "quadros"
    caminhos = extrair_quadros(video, saida, quantidade=6, lado_maximo=320)
    assert len(caminhos) == 6
    assert caminhos == sorted(caminhos)
    for c in caminhos:
        img = cv2.imread(str(c))
        assert max(img.shape[:2]) == 320
        assert nitidez(img) > 100  # nenhum tremido
        indice = int(Path(c).stem.split("_")[1])
        assert indice not in TREMIDOS


def test_video_inexistente_ou_invalido_da_erro_claro(tmp_path: Path):
    with pytest.raises(ValueError, match="não foi possível abrir o vídeo"):
        extrair_quadros(tmp_path / "nao-existe.mp4", tmp_path / "q", quantidade=5)
    lixo = tmp_path / "lixo.mp4"
    lixo.write_bytes(b"isto nao e video")
    with pytest.raises(ValueError, match="não foi possível abrir o vídeo"):
        extrair_quadros(lixo, tmp_path / "q", quantidade=5)
