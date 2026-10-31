"""
LGPD: rostos desfocados antes de qualquer foto sair do servidor (inclusive para a GPU na nuvem).
Detector YuNet (OpenCV Zoo, MIT). O desfoque é irreversível: pixelização + desfoque gaussiano.
"""

from pathlib import Path

import cv2
import numpy as np

MODELO = Path(__file__).resolve().parent.parent / "modelos" / "face_detection_yunet_2023mar.onnx"
CONFIANCA_MINIMA = 0.6
LADO_DETECCAO = 1600
EXTENSOES = {".jpg", ".jpeg", ".png", ".webp"}
Caixa = tuple[int, int, int, int]


def _detectar_em(imagem: np.ndarray) -> list[tuple[float, float, float, float, float]]:
    altura, largura = imagem.shape[:2]
    escala = min(1.0, LADO_DETECCAO / max(altura, largura))
    reduzida = cv2.resize(imagem, (round(largura * escala), round(altura * escala)), interpolation=cv2.INTER_AREA) if escala < 1 else imagem
    detector = cv2.FaceDetectorYN.create(str(MODELO), "", (reduzida.shape[1], reduzida.shape[0]), CONFIANCA_MINIMA, 0.3, 5000)
    _, rostos = detector.detect(reduzida)
    if rostos is None:
        return []
    return [(x / escala, y / escala, w / escala, h / escala, float(s)) for x, y, w, h, *_, s in rostos]


def _sobreposicao(a: Caixa, b: Caixa) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    return inter / min(a[2] * a[3], b[2] * b[3]) if inter else 0.0


def detectar_rostos(imagem: np.ndarray) -> list[Caixa]:
    """Caixas (x, y, largura, altura). Foto grande também é analisada em 4 pedaços, para rosto pequeno não escapar."""
    altura, largura = imagem.shape[:2]
    achados = _detectar_em(imagem)
    if max(altura, largura) > 1.5 * LADO_DETECCAO:
        folga_x, folga_y = largura // 10, altura // 10
        for x0 in (0, largura // 2 - folga_x):
            for y0 in (0, altura // 2 - folga_y):
                pedaco = imagem[y0 : y0 + altura // 2 + folga_y, x0 : x0 + largura // 2 + folga_x]
                achados += [(x + x0, y + y0, w, h, s) for x, y, w, h, s in _detectar_em(pedaco)]
    caixas: list[Caixa] = []
    for x, y, w, h, _ in sorted(achados, key=lambda r: -r[4]):
        c = (max(0, int(x)), max(0, int(y)), int(w), int(h))
        if c[2] > 0 and c[3] > 0 and all(_sobreposicao(c, k) < 0.3 for k in caixas):
            caixas.append(c)
    return caixas


def desfocar_rostos(imagem: np.ndarray) -> tuple[np.ndarray, int]:
    """Cópia da foto com cada rosto (mais 25% de margem) pixelado e borrado. Sem rosto, devolve a mesma foto."""
    caixas = detectar_rostos(imagem)
    if not caixas:
        return imagem, 0
    saida = imagem.copy()
    altura, largura = imagem.shape[:2]
    for x, y, w, h in caixas:
        mx, my = w // 4, h // 4
        x1, y1, x2, y2 = max(0, x - mx), max(0, y - my), min(largura, x + w + mx), min(altura, y + h + my)
        regiao = saida[y1:y2, x1:x2]
        miuda = cv2.resize(regiao, (6, 6), interpolation=cv2.INTER_AREA)
        bloco = cv2.resize(miuda, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST)
        saida[y1:y2, x1:x2] = cv2.GaussianBlur(bloco, (0, 0), max(3, (x2 - x1) // 12))
    return saida, len(caixas)


def processar_pasta(entrada: Path, saida: Path) -> dict[str, int]:
    """Grava em `saida` uma cópia de cada foto com os rostos desfocados. Devolve quantos rostos havia em cada uma."""
    saida.mkdir(parents=True, exist_ok=True)
    contagem: dict[str, int] = {}
    for arquivo in sorted(entrada.iterdir()):
        if arquivo.suffix.lower() not in EXTENSOES:
            continue
        imagem = cv2.imread(str(arquivo))
        if imagem is None:
            raise ValueError(f"não foi possível ler a foto {arquivo.name}")
        segura, n = desfocar_rostos(imagem)
        cv2.imwrite(str(saida / arquivo.name), segura, [cv2.IMWRITE_JPEG_QUALITY, 95])
        contagem[arquivo.name] = n
    return contagem
