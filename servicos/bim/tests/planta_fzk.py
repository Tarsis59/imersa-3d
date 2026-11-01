"""Planta baixa do térreo da casa FZK desenhada a partir do IFC real, com o gabarito (paredes, portas, janelas e
cômodos em metros). Serve para medir o detector de plantas com números: sabemos exatamente o que está desenhado.

Desenho como numa planta de arquitetura: paredes cortadas a 1 m do piso em preto cheio, janelas e folhas de porta
em traço fino, nomes dos cômodos e uma cota (o detector precisa ignorar texto e linhas finas).
"""
from __future__ import annotations

from pathlib import Path

import cv2
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ue
import numpy as np

FZK = Path(__file__).resolve().parents[3] / "exemplos" / "projeto-bim" / "AC20-FZK-Haus.ifc"
PX_POR_M = 50
MARGEM_M = 2.0


def _corte(verts: np.ndarray, faces: np.ndarray, z: float) -> list[tuple[np.ndarray, np.ndarray]]:
    """Segmentos (x, y) onde os triângulos cruzam o plano horizontal z."""
    segs = []
    for tri in faces:
        p = verts[tri]
        d = p[:, 2] - z
        pts = []
        for i in range(3):
            a, b = p[i], p[(i + 1) % 3]
            da, db = d[i], d[(i + 1) % 3]
            if (da < 0) != (db < 0):
                t = da / (da - db)
                pts.append((a + t * (b - a))[:2])
        if len(pts) == 2:
            segs.append((pts[0], pts[1]))
    return segs


def _forma(elemento):
    s = ifcopenshell.geom.settings()
    s.set("use-world-coords", True)
    g = ifcopenshell.geom.create_shape(s, elemento).geometry
    return np.array(g.verts).reshape(-1, 3), np.array(g.faces).reshape(-1, 3)


def gerar(saida: Path | None = None) -> dict:
    f = ifcopenshell.open(str(FZK))
    terreo = next(s for s in f.by_type("IfcBuildingStorey") if abs(float(s.Elevation)) < 0.01)
    no_terreo = lambda e: ue.get_container(e) == terreo  # noqa: E731
    paredes = [e for e in f.by_type("IfcWall") if no_terreo(e)]
    portas = [e for e in f.by_type("IfcDoor") if no_terreo(e)]
    janelas = [e for e in f.by_type("IfcWindow") if no_terreo(e)]
    espacos = [e for e in f.by_type("IfcSpace") if ue.get_aggregate(e) == terreo]

    formas = {e.GlobalId: _forma(e) for e in paredes + portas + janelas + espacos}
    todos = np.vstack([v for v, _ in formas.values()])
    minimo = todos[:, :2].min(0) - MARGEM_M
    maximo = todos[:, :2].max(0) + MARGEM_M
    largura, altura = np.ceil((maximo - minimo) * PX_POR_M).astype(int)

    def px(p) -> tuple[int, int]:
        # y do IFC para cima → linha da imagem para baixo
        return int(round((p[0] - minimo[0]) * PX_POR_M)), int(round((maximo[1] - p[1]) * PX_POR_M))

    img = np.full((altura, largura), 255, np.uint8)

    def contorno(segs, espessura: int = 1) -> np.ndarray:
        m = np.zeros_like(img)
        for a, b in segs:
            cv2.line(m, px(a), px(b), 255, espessura)
        return m

    # paredes: corte a 1 m, preenchido
    gabarito_paredes = []
    for e in paredes:
        v, fc = formas[e.GlobalId]
        m = contorno(_corte(v, fc, 1.0))
        cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        # só os contornos externos: o OpenCV 5 trata contorno interno desenhado junto como furo
        externos = [c for c, h in zip(cs, hier[0]) if h[3] == -1]
        cv2.drawContours(img, externos, -1, 0, cv2.FILLED)
        gabarito_paredes.append({"guid": e.GlobalId, "minimo": v[:, :2].min(0).tolist(), "maximo": v[:, :2].max(0).tolist()})
    # janelas: traço fino no vão (como em planta)
    for e in janelas:
        v, fc = formas[e.GlobalId]
        meio = (v[:, 2].min() + v[:, 2].max()) / 2
        for a, b in _corte(v, fc, meio):
            cv2.line(img, px(a), px(b), 0, 1)
    # portas: folha aberta a 90° e o arco de giro, em traço fino (convenção de planta)
    gabarito_portas = []
    for e in portas:
        v, _ = formas[e.GlobalId]
        mn, mx = v[:, :2].min(0), v[:, :2].max(0)
        horizontal = (mx[0] - mn[0]) >= (mx[1] - mn[1])
        largura_porta = (mx[0] - mn[0]) if horizontal else (mx[1] - mn[1])
        meio = (mn + mx) / 2
        if horizontal:
            dobradica, outra = np.array([mn[0], meio[1]]), np.array([mx[0], meio[1]])
            folha = dobradica + np.array([0.0, -largura_porta])
        else:
            dobradica, outra = np.array([meio[0], mn[1]]), np.array([meio[0], mx[1]])
            folha = dobradica + np.array([largura_porta, 0.0])
        cv2.line(img, px(dobradica), px(folha), 0, 1)
        r = int(round(largura_porta * PX_POR_M))
        a0 = np.degrees(np.arctan2(-(folha[1] - dobradica[1]), folha[0] - dobradica[0]))
        a1 = np.degrees(np.arctan2(-(outra[1] - dobradica[1]), outra[0] - dobradica[0]))
        ini, fim = sorted([a0, a1])
        if fim - ini > 180:
            ini, fim = fim, ini + 360
        cv2.ellipse(img, px(dobradica), (r, r), 0, ini, fim, 0, 1)
        gabarito_portas.append({"centro": meio.tolist(), "largura": float(largura_porta)})
    # ruído de planta de verdade: nomes dos cômodos e uma cota
    comodos = []
    for e in espacos:
        v, fc = formas[e.GlobalId]
        poli = np.array(v[:, :2])
        centro = (poli.min(0) + poli.max(0)) / 2
        nome = (e.LongName or e.Name or "").encode("ascii", "ignore").decode()
        cv2.putText(img, nome, px(centro), cv2.FONT_HERSHEY_SIMPLEX, 0.45, 0, 1, cv2.LINE_AA)
        comodos.append({"nome": e.LongName, "centro": centro.tolist(), "minimo": poli.min(0).tolist(), "maximo": poli.max(0).tolist()})
    y_cota = maximo[1] - MARGEM_M / 2
    cv2.line(img, px((minimo[0] + MARGEM_M, y_cota)), px((maximo[0] - MARGEM_M, y_cota)), 0, 1)
    cv2.putText(img, f"{maximo[0] - minimo[0] - 2 * MARGEM_M:.2f}", px(((minimo[0] + maximo[0]) / 2, y_cota + 0.15)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, 0, 1)

    if saida:
        cv2.imwrite(str(saida), img)
    return {
        "imagem": img,
        "px_por_m": PX_POR_M,
        "minimo": minimo.tolist(),
        "maximo": maximo.tolist(),
        "paredes": gabarito_paredes,
        "portas": gabarito_portas,
        "janelas": len(janelas),
        "comodos": comodos,
    }


if __name__ == "__main__":
    destino = FZK.parent / "planta-fzk-terreo.png"
    g = gerar(destino)
    print(destino, g["imagem"].shape, len(g["paredes"]), "paredes", len(g["portas"]), "portas", g["janelas"], "janelas", len(g["comodos"]), "cômodos")
