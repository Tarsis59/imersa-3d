"""Vídeo do imóvel → fotos para a reconstrução (os quadros mais nítidos, espalhados pelo vídeo todo)."""

from pathlib import Path
from statistics import median

import cv2
import numpy as np

from .nitidez import nitidez, selecionar_quadros


def reduzir(imagem: np.ndarray, lado_maximo: int) -> np.ndarray:
    altura, largura = imagem.shape[:2]
    escala = lado_maximo / max(altura, largura)
    if escala >= 1:
        return imagem
    return cv2.resize(imagem, (round(largura * escala), round(altura * escala)), interpolation=cv2.INTER_AREA)


def extrair_quadros(video: Path, pasta: Path, quantidade: int = 200, lado_maximo: int = 1600, nota_minima: float | None = None) -> list[Path]:
    """
    Lê o vídeo duas vezes (a 1ª só mede a nitidez em tamanho reduzido, para caber em pouca memória) e grava
    os quadros escolhidos como JPEG. Sem `nota_minima`, descarta o que estiver abaixo de 25% da nitidez mediana.
    """
    captura = cv2.VideoCapture(str(video))
    if not captura.isOpened():
        raise ValueError(f"não foi possível abrir o vídeo: {Path(video).name}")
    notas: list[float] = []
    while True:
        ok, quadro = captura.read()
        if not ok:
            break
        notas.append(nitidez(reduzir(quadro, 480)))
    captura.release()
    if not notas:
        raise ValueError(f"não foi possível abrir o vídeo (nenhum quadro legível): {Path(video).name}")

    minima = nota_minima if nota_minima is not None else 0.25 * median(notas)
    escolhidos = set(selecionar_quadros(notas, quantidade, minima))
    pasta.mkdir(parents=True, exist_ok=True)
    caminhos: list[Path] = []
    captura = cv2.VideoCapture(str(video))
    indice = 0
    while True:
        ok, quadro = captura.read()
        if not ok:
            break
        if indice in escolhidos:
            destino = pasta / f"quadro_{indice:05d}.jpg"
            cv2.imwrite(str(destino), reduzir(quadro, lado_maximo), [cv2.IMWRITE_JPEG_QUALITY, 95])
            caminhos.append(destino)
        indice += 1
    captura.release()
    return caminhos
