"""
Conjunto rotulado para medir o validador: capturas reais (Tanks&Temples/Deep Blending, do pacote do 3DGS)
como exemplos BONS e versões estragadas de propósito como RUINS (cada uma com um defeito típico de celular).
"""

import random
import zipfile
from pathlib import Path

import cv2
import numpy as np

ZIP = Path(__file__).resolve().parents[4] / "exemplos" / "fotos-para-reconstrucao" / "tandt_db.zip"


class Fotos:
    def __init__(self, caminho: Path = ZIP):
        self.zip = zipfile.ZipFile(caminho)
        self.cenas: dict[str, list[str]] = {}
        for nome in sorted(self.zip.namelist()):
            partes = nome.split("/")
            if len(partes) == 4 and partes[2] == "images" and partes[3]:
                self.cenas.setdefault(partes[1], []).append(nome)
        self._cache: dict[str, np.ndarray] = {}

    def ler(self, nome: str) -> np.ndarray:
        if nome not in self._cache:
            self._cache[nome] = cv2.imdecode(np.frombuffer(self.zip.read(nome), np.uint8), cv2.IMREAD_COLOR)
        return self._cache[nome]

    def trecho(self, cena: str, inicio: int, n: int, passo: int = 1) -> list[np.ndarray]:
        return [self.ler(x) for x in self.cenas[cena][inicio : inicio + n * passo : passo]]


def conjuntos(f: Fotos) -> list[tuple[str, list[np.ndarray], bool]]:
    rnd = random.Random(7)
    bons = [
        ("playroom-a", f.trecho("playroom", 0, 40, 2), True),
        ("playroom-b", f.trecho("playroom", 60, 40, 2), True),
        ("playroom-c", f.trecho("playroom", 130, 45, 2), True),
        ("drjohnson-a", f.trecho("drjohnson", 0, 40, 2), True),
        ("drjohnson-b", f.trecho("drjohnson", 90, 40, 2), True),
        ("drjohnson-c", f.trecho("drjohnson", 170, 45, 2), True),
        ("playroom-denso", f.trecho("playroom", 20, 60), True),
        ("drjohnson-denso", f.trecho("drjohnson", 40, 60), True),
        ("playroom-curto", f.trecho("playroom", 100, 22, 2), True),
        ("drjohnson-longo", f.trecho("drjohnson", 0, 120, 2), True),
    ]

    def estragar(fotos, fracao, fn):
        idx = set(rnd.sample(range(len(fotos)), round(len(fotos) * fracao)))
        return [fn(x) if i in idx else x for i, x in enumerate(fotos)]

    tremer = lambda x: cv2.GaussianBlur(x, (0, 0), 6)  # noqa: E731
    escurecer = lambda x: (x.astype(np.float32) * 0.12).astype(np.uint8)  # noqa: E731
    estourar = lambda x: np.clip(x.astype(np.float32) * 2.6 + 90, 0, 255).astype(np.uint8)  # noqa: E731
    encolher = lambda x: cv2.resize(x, (560, round(560 * x.shape[0] / x.shape[1])), interpolation=cv2.INTER_AREA)  # noqa: E731

    def sem_textura(x):
        h, w = x.shape[:2]
        return cv2.resize(x[h // 2 : h // 2 + 12, w // 2 : w // 2 + 18], (w, h), interpolation=cv2.INTER_CUBIC)

    todas = [n for cena in ("playroom", "drjohnson", "train", "truck") for n in f.cenas[cena]]
    embaralhadas = [f.ler(n) for n in rnd.sample(todas, 40)]
    alternadas = [f.ler(f.cenas[c][i * 5]) for i in range(10) for c in ("playroom", "drjohnson", "train", "truck")]
    ruins = [
        ("poucas", f.trecho("playroom", 0, 12, 2), False),
        ("tremidas-50", estragar(f.trecho("playroom", 0, 40, 2), 0.5, tremer), False),
        ("tremidas-70", estragar(f.trecho("drjohnson", 30, 40, 2), 0.7, tremer), False),
        ("escuras", estragar(f.trecho("drjohnson", 0, 40, 2), 0.7, escurecer), False),
        ("estouradas", estragar(f.trecho("playroom", 40, 40, 2), 0.6, estourar), False),
        ("embaralhadas", embaralhadas, False),
        ("cenas-alternadas", alternadas, False),
        ("baixa-resolucao", [encolher(x) for x in f.trecho("playroom", 0, 40, 2)], False),
        ("sem-textura", [sem_textura(x) for x in f.trecho("drjohnson", 0, 40, 2)], False),
        # caso difícil e honesto: fotos boas, de alta resolução, só que embaralhadas. O validador rápido não tem como
        # pegar (só avisa); quem recusa é o passo do COLMAP na nuvem, antes do treino na GPU.
        ("embaralhadas-alta-resolucao", [f.ler(n) for n in rnd.sample(f.cenas["playroom"] + f.cenas["drjohnson"], 40)], False),
        ("tremidas-e-escuras", estragar(estragar(f.trecho("playroom", 80, 40, 2), 0.25, tremer), 0.25, escurecer), False),
    ]
    return bons + ruins
