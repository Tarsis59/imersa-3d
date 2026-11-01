"""Leitor de plantas medido contra o gabarito: a planta do térreo da casa FZK é desenhada a partir do IFC real
(paredes, portas, janelas e cômodos conhecidos em metros)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import cv2
import ezdxf
import numpy as np
import pytest

from imersa_planta.detectar import detectar
from imersa_planta.entrada import PlantaInvalida, carregar

sys.path.insert(0, str(Path(__file__).parent))
import planta_fzk  # noqa: E402


@pytest.fixture(scope="module")
def fzk():
    return planta_fzk.gerar()


def _para_px(g: dict, x: float, y: float) -> tuple[float, float]:
    return (x - g["minimo"][0]) * g["px_por_m"], (g["maximo"][1] - y) * g["px_por_m"]


def _retangulos(forma, segs) -> np.ndarray:
    m = np.zeros(forma, np.uint8)
    for s in segs:
        meia = s["espessura"] / 2
        x1, x2 = sorted((s["x1"], s["x2"]))
        y1, y2 = sorted((s["y1"], s["y2"]))
        if y1 == y2:
            y1, y2 = y1 - meia, y2 + meia
        else:
            x1, x2 = x1 - meia, x2 + meia
        cv2.rectangle(m, (round(x1), round(y1)), (round(x2), round(y2)), 255, cv2.FILLED)
    return m


def _cobertura_paredes(g: dict, r: dict) -> tuple[float, float]:
    """(quanto da parede desenhada foi detectado, quanto do detectado é parede de verdade)."""
    verdade = cv2.morphologyEx((g["imagem"] == 0).astype(np.uint8) * 255, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8)) > 0
    achado = _retangulos(g["imagem"].shape, r["paredes"]) > 0
    return float(achado[verdade].mean()), float(verdade[achado].mean())


def test_fzk_paredes_portas_janelas_e_comodos(fzk):
    r = detectar(fzk["imagem"])
    recall, precisao = _cobertura_paredes(fzk, r)
    assert recall >= 0.95 and precisao >= 0.9, (recall, precisao)
    portas = [a for a in r["aberturas"] if a["tipo"] == "porta"]
    janelas = [a for a in r["aberturas"] if a["tipo"] == "janela"]
    assert len(janelas) == 9
    # cada porta do IFC tem uma porta detectada a menos de 0,3 m do centro
    for p in fzk["portas"]:
        cx, cy = _para_px(fzk, *p["centro"])
        assert any(np.hypot((a["x1"] + a["x2"]) / 2 - cx, (a["y1"] + a["y2"]) / 2 - cy) < 0.3 * fzk["px_por_m"] for a in portas), p
    assert len(portas) == 5
    # a passagem aberta do corredor para a cozinha/sala (sem porta no projeto)
    assert [a["tipo"] for a in r["aberturas"]].count("passagem") == 1
    # cômodos fechados: escritório, banheiro e quarto separados; corredor + cozinha + sala é uma área só (integrada)
    def comodo_de(nome):
        c = next(x for x in fzk["comodos"] if x["nome"] == nome)
        pt = _para_px(fzk, *c["centro"])
        dentro = [i for i, k in enumerate(r["comodos"]) if cv2.pointPolygonTest(np.array(k["poligono"], np.float32), pt, False) >= 0]
        assert len(dentro) == 1, nome
        return dentro[0]
    separados = {comodo_de(n) for n in ("Buero", "Bad", "Schlafzimmer")}
    assert len(separados) == 3
    integrado = {comodo_de(n) for n in ("Flur", "Küche", "Wohnen")}
    assert len(integrado) == 1 and not integrado & separados
    # área do quarto (m²) bate com o retângulo do ambiente no IFC (o cômodo detectado vai até a face das paredes)
    q = next(x for x in fzk["comodos"] if x["nome"] == "Schlafzimmer")
    area_ifc = (q["maximo"][0] - q["minimo"][0]) * (q["maximo"][1] - q["minimo"][1])
    area = r["comodos"][comodo_de("Schlafzimmer")]["areaPx"] / fzk["px_por_m"] ** 2
    assert abs(area - area_ifc) / area_ifc < 0.1, (area, area_ifc)
    assert r["escalaMPorPx"] is None and any("Escala" in x for x in r["avisos"])


def test_paredes_so_contornadas(fzk):
    # a mesma planta com as paredes só no contorno (outro jeito comum de imprimir)
    paredes = cv2.morphologyEx((fzk["imagem"] == 0).astype(np.uint8) * 255, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    miolo = cv2.erode(paredes, np.ones((3, 3), np.uint8))
    img = fzk["imagem"].copy()
    img[miolo > 0] = 255
    r = detectar(img)
    recall, precisao = _cobertura_paredes(fzk, r)
    assert recall >= 0.9 and precisao >= 0.85, (recall, precisao)
    assert sum(a["tipo"] == "janela" for a in r["aberturas"]) >= 8


def _pdf_com_imagem(cinza: np.ndarray, destino: Path) -> None:
    """PDF mínimo com a planta como JPEG (como sai de um escaneamento)."""
    ok, jpg = cv2.imencode(".jpg", cinza, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    jpg = jpg.tobytes()
    h, w = cinza.shape
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>".encode(),
        f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpg)} >>\nstream\n".encode() + jpg + b"\nendstream",
    ]
    conteudo = f"q {w} 0 0 {h} 0 0 cm /Im0 Do Q".encode()
    objs.append(f"<< /Length {len(conteudo)} >>\nstream\n".encode() + conteudo + b"\nendstream")
    saida = bytearray(b"%PDF-1.4\n")
    pos = []
    for i, o in enumerate(objs, 1):
        pos.append(len(saida))
        saida += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(saida)
    saida += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{p:010d} 00000 n \n".encode() for p in pos)
    saida += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    destino.write_bytes(bytes(saida))


def test_pdf_escaneado(fzk, tmp_path):
    pdf = tmp_path / "planta.pdf"
    _pdf_com_imagem(fzk["imagem"], pdf)
    cinza, escala = carregar(pdf)
    assert escala is None and cinza.ndim == 2
    r = detectar(cinza)
    # o PDF é desenhado em outra resolução: compara proporções
    assert sum(a["tipo"] == "janela" for a in r["aberturas"]) >= 8
    assert sum(a["tipo"] == "porta" for a in r["aberturas"]) >= 4
    assert len(r["comodos"]) == 4


def test_dxf_com_escala_exata(tmp_path):
    # casa de 6 × 4 m (eixos), paredes de 20 cm hachuradas, porta de 90 cm com arco, em metros
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 6
    msp = doc.modelspace()
    def parede(x1, y1, x2, y2):
        pts = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
        msp.add_lwpolyline(pts, close=True)
        msp.add_hatch().paths.add_polyline_path(pts, is_closed=True)
    parede(-0.1, -0.1, 6.1, 0.1)  # sul
    parede(-0.1, 3.9, 6.1, 4.1)  # norte
    parede(-0.1, -0.1, 0.1, 4.1)  # oeste
    parede(5.9, -0.1, 6.1, 1.0)  # leste, até a porta
    parede(5.9, 1.9, 6.1, 4.1)  # leste, depois da porta (vão de 0,9 m)
    msp.add_line((6.0, 1.0), (5.1, 1.0))  # folha aberta para dentro
    msp.add_arc((6.0, 1.0), 0.9, 90, 180)
    dxf = tmp_path / "casa.dxf"
    doc.saveas(dxf)
    cinza, escala = carregar(dxf)
    assert escala == pytest.approx(1 / 50)
    r = detectar(cinza, escala)
    assert [a["tipo"] for a in r["aberturas"]] == ["porta"]
    assert len(r["comodos"]) == 1
    area_m2 = r["comodos"][0]["areaPx"] * escala**2
    assert area_m2 == pytest.approx(5.8 * 3.8, rel=0.06)  # vão interno entre as faces
    assert not any("Escala" in x for x in r["avisos"])


def test_dwg_e_formato_estranho(tmp_path):
    (tmp_path / "a.dwg").write_bytes(b"AC1032")
    with pytest.raises(PlantaInvalida, match="DXF"):
        carregar(tmp_path / "a.dwg")
    with pytest.raises(PlantaInvalida, match="não aceito"):
        carregar(tmp_path / "a.gif")
    (tmp_path / "ruim.png").write_bytes(b"nao e imagem")
    with pytest.raises(PlantaInvalida, match="ilegível"):
        carregar(tmp_path / "ruim.png")


def test_folha_em_branco():
    r = detectar(np.full((300, 400), 255, np.uint8))
    assert r["paredes"] == [] and r["avisos"]


def test_linha_de_comando(fzk, tmp_path):
    entrada = tmp_path / "planta térreo.png"  # acento e espaço no caminho
    cv2.imencode(".png", fzk["imagem"])[1].tofile(str(entrada))
    img, res = tmp_path / "saida.png", tmp_path / "r.json"
    p = subprocess.run([sys.executable, "-m", "imersa_planta", "--entrada", str(entrada), "--imagem", str(img), "--resultado", str(res)], capture_output=True, text=True, cwd=Path(__file__).parents[1])
    assert p.returncode == 0, p.stderr
    r = json.loads(res.read_text(encoding="utf-8"))
    assert r["largura"] == fzk["imagem"].shape[1] and len(r["paredes"]) > 10
    assert cv2.imread(str(img), cv2.IMREAD_GRAYSCALE).shape == fzk["imagem"].shape
    ruim = tmp_path / "x.dwg"
    ruim.write_bytes(b"AC1032")
    p = subprocess.run([sys.executable, "-m", "imersa_planta", "--entrada", str(ruim), "--imagem", str(img), "--resultado", str(res)], capture_output=True, text=True, cwd=Path(__file__).parents[1])
    assert p.returncode == 2 and "DXF" in json.loads(res.read_text(encoding="utf-8"))["erro"]
