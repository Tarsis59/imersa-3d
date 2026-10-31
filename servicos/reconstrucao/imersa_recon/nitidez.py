"""Nitidez de imagem (variância do Laplaciano) e escolha dos melhores quadros de um vídeo."""

from collections.abc import Sequence

import cv2
import numpy as np


def nitidez(imagem: np.ndarray) -> float:
    """Variância do Laplaciano: alta com bordas definidas, baixa com tremido/desfoque."""
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    return float(cv2.Laplacian(cinza, cv2.CV_64F).var())


def selecionar_quadros(notas: Sequence[float], quantidade: int, nota_minima: float = 0.0) -> list[int]:
    """
    Divide o vídeo em `quantidade` trechos seguidos e pega o quadro mais nítido de cada um
    (cobre o ambiente inteiro, sem amontoar quadros num só lugar). Trecho sem nenhum quadro
    com nota >= `nota_minima` é descartado. Devolve os índices em ordem.
    """
    if not notas or quantidade <= 0:
        return []
    escolhidos: list[int] = []
    for trecho in np.array_split(np.arange(len(notas)), min(quantidade, len(notas))):
        melhor = int(trecho[int(np.argmax([notas[i] for i in trecho]))])
        if notas[melhor] >= nota_minima:
            escolhidos.append(melhor)
    return escolhidos
