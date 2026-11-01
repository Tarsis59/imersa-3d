"""Abre a planta enviada e devolve a imagem em tons de cinza (+ a escala, quando o arquivo diz).

- PNG/JPG: a imagem como veio (reduzida se for enorme). Escala desconhecida: o editor calibra.
- PDF: a 1ª página desenhada a ~200 dpi (pypdfium2, Apache/BSD). Escala desconhecida.
- DXF (o CAD salva em DXF): linhas, polilinhas, arcos, círculos e hachuras desenhados em metros, com escala exata.
- DWG: formato fechado da Autodesk, sem leitor livre confiável: pede para salvar como DXF (todo CAD faz).
"""
from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

LADO_MAXIMO = 4000
PX_POR_M_DXF = 50
# $INSUNITS do DXF → metros
UNIDADES_DXF = {0: 1.0, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0, 14: 0.1}


class PlantaInvalida(ValueError):
    pass


def _reduzir(img: np.ndarray, escala: float | None) -> tuple[np.ndarray, float | None]:
    lado = max(img.shape[:2])
    if lado <= LADO_MAXIMO:
        return img, escala
    f = LADO_MAXIMO / lado
    menor = cv2.resize(img, (round(img.shape[1] * f), round(img.shape[0] * f)), interpolation=cv2.INTER_AREA)
    return menor, (escala / f if escala else None)


def _imagem(caminho: Path) -> np.ndarray:
    dados = np.fromfile(str(caminho), np.uint8)  # caminho com acento no Windows
    img = cv2.imdecode(dados, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise PlantaInvalida("imagem ilegível")
    if img.ndim == 3 and img.shape[2] == 4:
        # transparência vira papel branco
        alfa = img[:, :, 3:4].astype(np.float32) / 255
        img = (img[:, :, :3] * alfa + 255 * (1 - alfa)).astype(np.uint8)
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img


def _pdf(caminho: Path) -> np.ndarray:
    import pypdfium2 as pdfium

    try:
        doc = pdfium.PdfDocument(str(caminho))
    except Exception as e:  # noqa: BLE001
        raise PlantaInvalida(f"PDF ilegível: {e}") from e
    if len(doc) == 0:
        raise PlantaInvalida("PDF sem páginas")
    pagina = doc[0]
    w, h = pagina.get_size()
    escala = min(200 / 72, LADO_MAXIMO / max(w, h))
    img = pagina.render(scale=escala, grayscale=True).to_numpy()
    doc.close()
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _dxf(caminho: Path) -> tuple[np.ndarray, float]:
    import ezdxf
    from ezdxf import bbox

    try:
        doc = ezdxf.readfile(str(caminho))
    except Exception as e:  # noqa: BLE001
        raise PlantaInvalida(f"DXF ilegível: {e}") from e
    msp = doc.modelspace()
    para_m = UNIDADES_DXF.get(int(doc.header.get("$INSUNITS", 0)), 1.0)
    caixa = bbox.extents(msp)
    if not caixa.has_data:
        raise PlantaInvalida("DXF sem desenho")
    margem = 1.0 / para_m
    x0, y0 = caixa.extmin.x - margem, caixa.extmin.y - margem
    largura_m = (caixa.extmax.x - caixa.extmin.x + 2 * margem) * para_m
    altura_m = (caixa.extmax.y - caixa.extmin.y + 2 * margem) * para_m
    px_por_m = min(PX_POR_M_DXF, LADO_MAXIMO / max(largura_m, altura_m))
    w, h = math.ceil(largura_m * px_por_m), math.ceil(altura_m * px_por_m)
    img = np.full((h, w), 255, np.uint8)

    def px(x: float, y: float) -> tuple[int, int]:
        return round((x - x0) * para_m * px_por_m), round(h - (y - y0) * para_m * px_por_m)

    for e in msp:
        t = e.dxftype()
        if t == "LINE":
            cv2.line(img, px(e.dxf.start.x, e.dxf.start.y), px(e.dxf.end.x, e.dxf.end.y), 0, 1)
        elif t in ("LWPOLYLINE", "POLYLINE"):
            pts = [px(p[0], p[1]) for p in (e.get_points("xy") if t == "LWPOLYLINE" else [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices])]
            if len(pts) >= 2:
                cv2.polylines(img, [np.array(pts, np.int32)], bool(e.closed if t == "LWPOLYLINE" else e.is_closed), 0, 1)
        elif t in ("ARC", "CIRCLE"):
            c = px(e.dxf.center.x, e.dxf.center.y)
            r = round(e.dxf.radius * para_m * px_por_m)
            ini, fim = (e.dxf.start_angle, e.dxf.end_angle) if t == "ARC" else (0.0, 360.0)
            if fim < ini:
                fim += 360
            # no DXF o ângulo é anti-horário com y para cima; na imagem, y para baixo
            cv2.ellipse(img, c, (r, r), 0, -fim, -ini, 0, 1)
        elif t == "HATCH" and e.dxf.solid_fill:
            for caminho_h in e.paths:
                vertices = getattr(caminho_h, "vertices", None)
                if vertices:
                    cv2.fillPoly(img, [np.array([px(v[0], v[1]) for v in vertices], np.int32)], 0)
    return img, 1.0 / px_por_m


def carregar(caminho: str | Path) -> tuple[np.ndarray, float | None]:
    """Imagem em tons de cinza (uint8) e a escala em metros por pixel (None se o arquivo não diz)."""
    caminho = Path(caminho)
    ext = caminho.suffix.lower()
    if ext in (".png", ".jpg", ".jpeg"):
        return _reduzir(_imagem(caminho), None)
    if ext == ".pdf":
        return _reduzir(_pdf(caminho), None)
    if ext == ".dxf":
        return _dxf(caminho)
    if ext == ".dwg":
        raise PlantaInvalida("DWG é um formato fechado: no CAD, use Salvar como → DXF e envie o DXF")
    raise PlantaInvalida(f"formato de planta não aceito: {ext}")
