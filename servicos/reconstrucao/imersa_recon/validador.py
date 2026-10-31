"""
Validador de qualidade das fotos (só CPU, segundos): evita gastar GPU com um conjunto que não vai virar 3D.
Mensagens em português, para a consultora saber o que refazer.

Bloqueiam só as verificações confiáveis (quantidade, resolução, tremido, exposição/textura). A sobreposição
estimada aqui (pares de fotos vizinhas) vira AVISO: medida rápida em pares se confunde com o ruído em fotos
legítimas mais espaçadas. A confirmação de verdade é a fração de câmeras que o COLMAP consegue posicionar,
feita no início do trabalho na nuvem, antes do treino na GPU (ver `kaggle/treinar.py`).
"""

from collections.abc import Sequence
from dataclasses import dataclass, field

import cv2
import numpy as np

from .nitidez import nitidez
from .video import reduzir

MIN_FOTOS = 20
MAX_FOTOS = 1000
MIN_LADO_PX = 1000
LADO_ANALISE_PX = 640
#: Abaixo disso (Laplaciano a 640 px) a foto está tremida ou fora de foco.
LIMIAR_TREMIDA = 40.0
#: Brilho médio (0–255) fora desta faixa = escura ou estourada.
FAIXA_BRILHO = (45.0, 215.0)
#: Pontos em comum (confirmados geometricamente) para duas fotos "se enxergarem".
MIN_PONTOS_EM_COMUM = 20
#: Cada foto é comparada com as próximas N (tolera uma foto fora do caminho).
VIZINHAS = 3
#: Frações a partir das quais o conjunto é recusado.
MAX_FRACAO_TREMIDAS = 0.3
MAX_FRACAO_EXPOSICAO = 0.3
#: Abaixo disso (fotos no maior grupo ligado), avisa que a sobreposição parece fraca.
AVISO_FRACAO_CONECTADA = 0.5
MAX_FRACAO_BAIXA_RESOLUCAO = 0.3


@dataclass
class Relatorio:
    aprovado: bool
    problemas: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)
    metricas: dict[str, float] = field(default_factory=dict)


def brilho(imagem: np.ndarray) -> float:
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    return float(cinza.mean())


_sift = cv2.SIFT_create(nfeatures=2000)
Pontos = tuple[tuple, np.ndarray | None]


def caracteristicas(imagem: np.ndarray) -> Pontos:
    cinza = cv2.cvtColor(imagem, cv2.COLOR_BGR2GRAY) if imagem.ndim == 3 else imagem
    return _sift.detectAndCompute(cinza, None)


def pontos_em_comum(a: Pontos, b: Pontos) -> int:
    """Correspondências SIFT que sobrevivem ao teste da razão e à geometria (matriz fundamental com RANSAC)."""
    (ka, da), (kb, db) = a, b
    if da is None or db is None or len(ka) < 8 or len(kb) < 8:
        return 0
    pares = cv2.BFMatcher(cv2.NORM_L2).knnMatch(da, db, k=2)
    bons = [p[0] for p in pares if len(p) == 2 and p[0].distance < 0.8 * p[1].distance]
    if len(bons) < 8:
        return 0
    pa = np.float32([ka[m.queryIdx].pt for m in bons])
    pb = np.float32([kb[m.trainIdx].pt for m in bons])
    _, mascara = cv2.findFundamentalMat(pa, pb, cv2.FM_RANSAC, 3.0, 0.99)
    return int(mascara.sum()) if mascara is not None else 0


def fracao_conectada(pontos: Sequence[Pontos], vizinhas: int = VIZINHAS) -> float:
    """Fração das fotos no maior grupo ligado por pontos em comum (cada foto x as `vizinhas` seguintes)."""
    n = len(pontos)
    if n < 2:
        return 0.0
    pai = list(range(n))

    def raiz(i: int) -> int:
        while pai[i] != i:
            pai[i] = pai[pai[i]]
            i = pai[i]
        return i

    for i in range(n):
        for j in range(i + 1, min(n, i + 1 + vizinhas)):
            if raiz(i) != raiz(j) and pontos_em_comum(pontos[i], pontos[j]) >= MIN_PONTOS_EM_COMUM:
                pai[raiz(i)] = raiz(j)
    grupos: dict[int, int] = {}
    for i in range(n):
        grupos[raiz(i)] = grupos.get(raiz(i), 0) + 1
    return max(grupos.values()) / n


def avaliar(imagens: Sequence[np.ndarray]) -> Relatorio:
    """`imagens` na ordem em que foram tiradas (BGR, tamanho original)."""
    r = Relatorio(aprovado=True)
    n = len(imagens)
    r.metricas["fotos"] = n
    if n < MIN_FOTOS:
        r.problemas.append(f"Poucas fotos ({n}). Envie pelo menos {MIN_FOTOS}; o ideal é de 80 a 300, andando devagar pelo ambiente.")
    if n > MAX_FOTOS:
        r.problemas.append(f"Fotos demais ({n}). O limite é {MAX_FOTOS}; escolha as melhores ou envie um vídeo.")
    if n == 0:
        r.aprovado = False
        return r

    baixas = sum(max(i.shape[:2]) < MIN_LADO_PX for i in imagens) / n
    pequenas = [reduzir(i, LADO_ANALISE_PX) for i in imagens]
    notas = [nitidez(p) for p in pequenas]
    brilhos = [brilho(p) for p in pequenas]
    tremidas = sum(x < LIMIAR_TREMIDA for x in notas) / n
    exposicao = sum(not (FAIXA_BRILHO[0] <= x <= FAIXA_BRILHO[1]) for x in brilhos) / n
    sobreposicao = fracao_conectada([caracteristicas(p) for p in pequenas])
    r.metricas.update(
        baixa_resolucao=baixas,
        tremidas=tremidas,
        exposicao_ruim=exposicao,
        sobreposicao=sobreposicao,
        nitidez_mediana=float(np.median(notas)),
        brilho_mediano=float(np.median(brilhos)),
    )

    pct = lambda x: f"{round(x * 100)}%"  # noqa: E731
    if baixas > MAX_FRACAO_BAIXA_RESOLUCAO:
        r.problemas.append(f"{pct(baixas)} das fotos têm resolução baixa (menos de {MIN_LADO_PX} px). Use a câmera principal do celular, sem zoom.")
    elif baixas > 0:
        r.avisos.append(f"{pct(baixas)} das fotos têm resolução baixa.")
    if tremidas > MAX_FRACAO_TREMIDAS:
        r.problemas.append(f"{pct(tremidas)} das fotos estão tremidas ou fora de foco. Ande mais devagar e espere a câmera focar.")
    elif tremidas > 0.1:
        r.avisos.append(f"{pct(tremidas)} das fotos estão tremidas; elas serão ignoradas.")
    if exposicao > MAX_FRACAO_EXPOSICAO:
        r.problemas.append(f"{pct(exposicao)} das fotos estão escuras demais ou estouradas. Acenda as luzes e evite fotografar contra a janela.")
    elif exposicao > 0.1:
        r.avisos.append(f"{pct(exposicao)} das fotos têm luz ruim.")
    if n >= 2 and sobreposicao < AVISO_FRACAO_CONECTADA:
        r.avisos.append(
            f"Pelo jeito, só {pct(sobreposicao)} das fotos se encaixam umas nas outras. Se a reconstrução recusar, refaça com "
            "passos curtos, girando devagar e na ordem do caminho (cada foto repetindo boa parte da anterior)."
        )
    r.aprovado = not r.problemas
    return r
