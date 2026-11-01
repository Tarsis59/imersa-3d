"""Planta baixa (imagem) → paredes, aberturas (porta, janela, passagem) e cômodos, em pixels.

Visão computacional clássica (OpenCV), sem modelo pago nem treinamento: funciona em plantas de arquitetura com
paredes cortadas em preto cheio (o padrão de impressão do Revit/AutoCAD/ArchiCAD) ou só contornadas. O resultado é
um rascunho para o editor do Imersa: a pessoa confere, corrige e calibra a escala (quantos metros tem uma medida).

Passos:
1. tinta = pixels escuros (limiar de Otsu); paredes contornadas têm o miolo preenchido;
2. espessura típica da parede pela transformada de distância (texto e linhas finas ficam de fora);
3. abertura morfológica: some tudo que é mais fino que a parede (texto, cotas, folhas de porta, janelas);
4. faixas horizontais e verticais → segmentos de parede (eixo + espessura);
5. vãos entre segmentos alinhados → janela (traço fino dentro do vão), porta (arco de giro ao lado) ou passagem;
6. cômodos = áreas livres fechadas por paredes, portas e janelas (o que encosta na borda é o lado de fora).
"""
from __future__ import annotations

import cv2
import numpy as np


def _tinta(cinza: np.ndarray) -> np.ndarray:
    _, b = cv2.threshold(cinza, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return b


def _preencher_paredes_contornadas(tinta: np.ndarray) -> np.ndarray:
    """Miolos brancos pequenos e estreitos (paredes desenhadas só com o contorno) viram tinta. Cômodos são grandes e
    ficam como estão; os vãos minúsculos (janela em traço duplo, olho de letra) também."""
    branco = (tinta == 0).astype(np.uint8)
    n, rot, stats, _ = cv2.connectedComponentsWithStats(branco, connectivity=4)
    if n <= 1:
        return tinta
    dist = cv2.distanceTransform(branco, cv2.DIST_L2, 3)
    raio = np.zeros(n, np.float32)
    np.maximum.at(raio, rot.ravel(), dist.ravel())
    h, w = tinta.shape
    limite = max(4.0, 0.012 * max(h, w))
    toca_borda = np.zeros(n, bool)
    toca_borda[np.unique(np.concatenate([rot[0], rot[-1], rot[:, 0], rot[:, -1]]))] = True
    encher = (raio >= 2.5) & (raio <= limite) & ~toca_borda
    encher[0] = False
    saida = tinta.copy()
    saida[encher[rot]] = 255
    return saida


def _meia_espessura(tinta: np.ndarray) -> float | None:
    """Meia espessura típica das paredes (px): mediana dos máximos locais da distância, sem os traços finos."""
    dist = cv2.distanceTransform(tinta, cv2.DIST_L2, 3)
    maximos = (dist >= 2.0) & (dist >= cv2.dilate(dist, np.ones((3, 3), np.uint8)))
    valores = dist[maximos]
    if valores.size < 20:
        return None
    # os traços mais grossos que sobram depois do texto são as paredes
    return float(np.percentile(valores, 60))


def _segmentos(paredes: np.ndarray, comprimento: int, horizontal: bool) -> list[dict]:
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (comprimento, 1) if horizontal else (1, comprimento))
    faixa = cv2.morphologyEx(paredes, cv2.MORPH_OPEN, k)
    n, rot, stats, _ = cv2.connectedComponentsWithStats(faixa, connectivity=8)
    segs = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if horizontal:
            esp = area / w
            if w < 1.5 * esp:
                continue
            yc = y + h / 2
            segs.append({"x1": float(x), "y1": float(yc), "x2": float(x + w), "y2": float(yc), "espessura": float(esp)})
        else:
            esp = area / h
            if h < 1.5 * esp:
                continue
            xc = x + w / 2
            segs.append({"x1": float(xc), "y1": float(y), "x2": float(xc), "y2": float(y + h), "espessura": float(esp)})
    return segs


def _pedacos_curtos(paredes_px: np.ndarray, horiz: list[dict], vert: list[dict], meia: float) -> None:
    """Pedaço de parede mais curto que o filtro das faixas (batente ao lado de porta, ponta de parede): o que sobrou
    da tinta grossa sem segmento vira um segmento curto, no sentido do lado maior."""
    cobertas = np.zeros_like(paredes_px)
    for s in horiz + vert:
        _desenhar_retangulo(cobertas, s)
    resto = cv2.morphologyEx(cv2.bitwise_and(paredes_px, cv2.bitwise_not(cobertas)), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(resto, connectivity=8)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < (meia * 2) ** 2 * 0.5:
            continue
        if w >= h:
            esp = area / w
            horiz.append({"x1": float(x), "y1": float(y + h / 2), "x2": float(x + w), "y2": float(y + h / 2), "espessura": float(esp)})
        else:
            esp = area / h
            vert.append({"x1": float(x + w / 2), "y1": float(y), "x2": float(x + w / 2), "y2": float(y + h), "espessura": float(esp)})


def _classificar_vao(tinta_original: np.ndarray, horizontal: bool, ini: float, fim: float, eixo: float, esp: float) -> str:
    """Janela: traço fino dentro do vão. Porta: arco de giro de raio = vão, centrado numa das pontas (dobradiça), de
    um lado ou do outro da parede. Senão: passagem aberta (vão sem porta)."""
    h, w = tinta_original.shape
    vao = fim - ini
    meia = max(2.0, esp / 2)
    a, b = int(round(ini + 1)), int(round(fim - 1))
    if b <= a:
        return "passagem"
    if horizontal:
        dentro = tinta_original[max(0, int(eixo - meia)) : min(h, int(eixo + meia) + 1), a:b]
    else:
        dentro = tinta_original[a:b, max(0, int(eixo - meia)) : min(w, int(eixo + meia) + 1)]
    if dentro.size and (dentro > 0).mean() >= 0.06:
        return "janela"
    # tolerância proporcional ao desenho (planta em resolução maior → traços e desvios maiores)
    k = max(5, int(esp * 0.35) | 1)
    tinta_larga = cv2.dilate(tinta_original, np.ones((k, k), np.uint8))
    angulos = np.linspace(0.15, np.pi / 2 - 0.15, 24)
    for ponta, rumo in ((ini, 1.0), (fim, -1.0)):
        for lado in (-1.0, 1.0):
            # dobradiça perto da ponta do vão (no eixo ou numa face da parede); o arco vai da direção do vão até a
            # perpendicular (folha aberta). O raio é a largura da folha, perto da largura do vão
            for desloc in (0.0, meia, -meia):
                for raio in (vao, vao * 0.92, vao * 1.08):
                    ao_longo = ponta + rumo * raio * np.cos(angulos)
                    perp = eixo + lado * (desloc + raio * np.sin(angulos))
                    xs, ys = (ao_longo, perp) if horizontal else (perp, ao_longo)
                    dentro_img = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
                    if dentro_img.sum() < len(angulos) * 0.8:
                        continue
                    acertos = tinta_larga[ys[dentro_img].astype(int), xs[dentro_img].astype(int)] > 0
                    if acertos.mean() >= 0.75:
                        return "porta"
    return "passagem"


def _vaos(segs: list[dict], horizontal: bool, tinta_original: np.ndarray) -> list[dict]:
    """Vão = espaço entre dois segmentos alinhados (mesmo eixo, espessura parecida)."""
    eixo = (lambda s: s["y1"]) if horizontal else (lambda s: s["x1"])
    ini = (lambda s: s["x1"]) if horizontal else (lambda s: s["y1"])
    fim = (lambda s: s["x2"]) if horizontal else (lambda s: s["y2"])
    aberturas = []
    ordem = sorted(segs, key=lambda s: (round(eixo(s)), ini(s)))
    for i, s in enumerate(ordem):
        # o próximo segmento no mesmo alinhamento, à frente deste
        candidatos = [
            t
            for t in ordem[i + 1 :]
            if abs(eixo(t) - eixo(s)) <= max(s["espessura"], t["espessura"]) / 2 and ini(t) > fim(s) and 0.5 <= t["espessura"] / s["espessura"] <= 2
        ]
        if not candidatos:
            continue
        t = min(candidatos, key=ini)
        esp = (s["espessura"] + t["espessura"]) / 2
        vao = ini(t) - fim(s)
        if not 1.5 * esp <= vao <= 25 * esp:
            continue
        e = (eixo(s) + eixo(t)) / 2
        tipo = _classificar_vao(tinta_original, horizontal, fim(s), ini(t), e, esp)
        if horizontal:
            aberturas.append({"tipo": tipo, "x1": fim(s), "y1": e, "x2": ini(t), "y2": e, "espessura": esp})
        else:
            aberturas.append({"tipo": tipo, "x1": e, "y1": fim(s), "x2": e, "y2": ini(t), "espessura": esp})
    return aberturas


def _desenhar_retangulo(mascara: np.ndarray, s: dict, valor: int = 255) -> None:
    m = s["espessura"] / 2
    x1, x2 = sorted((s["x1"], s["x2"]))
    y1, y2 = sorted((s["y1"], s["y2"]))
    if y1 == y2:
        y1, y2 = y1 - m, y2 + m
    else:
        x1, x2 = x1 - m, x2 + m
    cv2.rectangle(mascara, (int(round(x1)), int(round(y1))), (int(round(x2)), int(round(y2))), valor, cv2.FILLED)


def _comodos(forma: tuple[int, int], paredes: list[dict], aberturas: list[dict], esp_media: float) -> list[dict]:
    barreira = np.zeros(forma, np.uint8)
    for s in paredes:
        _desenhar_retangulo(barreira, s)
    # portas e janelas fecham o cômodo; passagem aberta não
    for a in aberturas:
        if a["tipo"] != "passagem":
            _desenhar_retangulo(barreira, a)
    barreira = cv2.dilate(barreira, np.ones((3, 3), np.uint8))
    livre = (barreira == 0).astype(np.uint8)
    n, rot, stats, centros = cv2.connectedComponentsWithStats(livre, connectivity=4)
    h, w = forma
    borda = set(np.unique(np.concatenate([rot[0], rot[-1], rot[:, 0], rot[:, -1]])).tolist())
    minimo = (6 * esp_media) ** 2
    comodos = []
    for i in range(1, n):
        x, y, cw, ch, area = stats[i]
        if i in borda or area < minimo or min(cw, ch) < 3 * esp_media:
            continue
        cs, _ = cv2.findContours((rot == i).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(cs, key=cv2.contourArea)
        poli = cv2.approxPolyDP(c, 0.01 * cv2.arcLength(c, True), True).reshape(-1, 2)
        comodos.append({"poligono": poli.astype(float).tolist(), "areaPx": float(area), "centro": [float(centros[i][0]), float(centros[i][1])]})
    return comodos


def detectar(cinza: np.ndarray, escala_m_por_px: float | None = None) -> dict:
    """Paredes, aberturas e cômodos de uma planta em tons de cinza (uint8). Coordenadas em pixels da imagem."""
    if cinza.ndim != 2 or cinza.dtype != np.uint8:
        raise ValueError("planta precisa estar em tons de cinza (uint8)")
    h, w = cinza.shape
    tinta = _tinta(cinza)
    cheia = _preencher_paredes_contornadas(tinta)
    meia = _meia_espessura(cheia)
    base = {"largura": int(w), "altura": int(h), "escalaMPorPx": escala_m_por_px}
    if meia is None:
        return {**base, "espessuraPx": None, "paredes": [], "aberturas": [], "comodos": [], "avisos": ["Nenhuma parede encontrada: a planta está nítida e com as paredes escuras?"]}
    # some tudo o que é mais fino que a parede: texto, cotas, folhas e arcos de porta, janelas
    nucleo = max(3, int(round(meia * 1.2)))
    paredes_px = cv2.morphologyEx(cheia, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (nucleo, nucleo)))
    comprimento = max(10, int(round(meia * 2 * 3)))
    horiz = _segmentos(paredes_px, comprimento, True)
    vert = _segmentos(paredes_px, comprimento, False)
    _pedacos_curtos(paredes_px, horiz, vert, meia)
    paredes = horiz + vert
    aberturas = _vaos(horiz, True, tinta) + _vaos(vert, False, tinta)
    esp_media = float(np.median([s["espessura"] for s in paredes])) if paredes else meia * 2
    comodos = _comodos((h, w), paredes, aberturas, esp_media)
    # quanto da tinta grossa ficou explicada por paredes retas (parede inclinada ou curva fica para o editor)
    cobertas = np.zeros((h, w), np.uint8)
    for s in paredes:
        _desenhar_retangulo(cobertas, s)
    grossa = paredes_px > 0
    cobertura = float((cobertas[grossa] > 0).mean()) if grossa.any() else 1.0
    avisos = []
    if cobertura < 0.9:
        avisos.append(f"{round((1 - cobertura) * 100)}% das paredes não são retas na horizontal/vertical: confira e desenhe no editor.")
    if escala_m_por_px is None:
        avisos.append("Escala desconhecida: marque no editor uma medida conhecida (por exemplo, uma cota).")
    return {**base, "espessuraPx": esp_media, "paredes": paredes, "aberturas": aberturas, "comodos": comodos, "cobertura": cobertura, "avisos": avisos}
