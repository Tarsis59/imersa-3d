import json
import struct
from pathlib import Path

import numpy as np
import pytest

from imersa_bim.converter import converter
from imersa_bim.glb import ler_glb
from imersa_bim.metadados import ler_metadados
from imersa_bim.vinculo import sugerir_vinculos

FZK = Path(__file__).resolve().parents[3] / "exemplos" / "projeto-bim" / "AC20-FZK-Haus.ifc"
pytestmark = pytest.mark.skipif(not FZK.exists(), reason="modelo de teste FZK-Haus não encontrado")


@pytest.fixture(scope="module")
def meta():
    return ler_metadados(FZK)


@pytest.fixture(scope="module")
def glb(tmp_path_factory):
    destino = tmp_path_factory.mktemp("bim") / "casa.glb"
    resumo = converter(FZK, destino)
    return resumo, destino


def caixa_mundo(doc: dict) -> tuple[np.ndarray, np.ndarray]:
    """Caixa de todos os vértices já com a matriz de cada nó (o que o visualizador vai ver)."""
    minimo, maximo = np.full(3, np.inf), np.full(3, -np.inf)
    for no in doc["nodes"]:
        if "mesh" not in no:
            continue
        m = np.array(no.get("matrix", np.eye(4).flatten(order="F").tolist())).reshape(4, 4, order="F")
        for prim in doc["meshes"][no["mesh"]]["primitives"]:
            a = doc["accessors"][prim["attributes"]["POSITION"]]
            for canto in np.array(np.meshgrid(*zip(a["min"], a["max"]))).T.reshape(-1, 3):
                p = m @ np.append(canto, 1.0)
                minimo, maximo = np.minimum(minimo, p[:3]), np.maximum(maximo, p[:3])
    return minimo, maximo


def test_metadados_fzk(meta):
    assert meta["schema"] == "IFC4"
    assert [a["nome"] for a in meta["andares"]] == ["Erdgeschoss", "Dachgeschoss"]
    assert [a["elevacao_m"] for a in meta["andares"]] == [0.0, 2.7]
    assert len(meta["espacos"]) == 7
    quarto = next(e for e in meta["espacos"] if e["nome"] == "4")
    assert quarto["nome_longo"] == "Schlafzimmer"
    assert quarto["area_m2"] == pytest.approx(21.41, abs=0.01)  # área útil (NetFloorArea)
    assert quarto["andar_guid"] == meta["andares"][0]["guid"]
    assert sum(e["andar_guid"] == meta["andares"][1]["guid"] for e in meta["espacos"]) == 1
    assert next(e for e in meta["espacos"] if e["nome"] == "6")["nome_longo"] == "Küche"  # acentos do IFC decodificados
    assert meta["portas"] == 5 and meta["janelas"] == 11


def test_glb_y_para_cima_nomes_por_guid_e_tipos(glb, meta):
    resumo, destino = glb
    doc, _ = ler_glb(destino)
    assert destino.read_bytes()[:4] == b"glTF"
    assert resumo["elementos"] == 107
    nomes = {n.get("name") for n in doc["nodes"]}
    assert {e["guid"] for e in meta["espacos"]} <= nomes  # cada ambiente vira um nó com o GUID (vínculo com a unidade)
    # tipo IFC em cada nó (o visualizador esconde ambientes não vinculados; o configurador acha pisos e paredes)
    tipos = {n["extras"]["ifc"] for n in doc["nodes"] if "extras" in n}
    assert {"IfcWall", "IfcSlab", "IfcSpace", "IfcDoor", "IfcWindow"} <= tipos
    assert not any(t.endswith("StandardCase") for t in tipos)
    espaco = next(n for n in doc["nodes"] if n.get("extras", {}).get("ifc") == "IfcSpace")
    assert espaco["extras"]["areaM2"] > 0
    # glTF é Y para cima: a casa tem ~6-9 m de altura em Y e se espalha em X/Z
    minimo, maximo = caixa_mundo(doc)
    altura = maximo[1] - minimo[1]
    assert 5 < altura < 10
    assert maximo[0] - minimo[0] > altura and maximo[2] - minimo[2] > altura


def test_vinculo_automatico_por_codigo_e_nome(meta):
    unidades = [
        {"id": "u1", "codigo": "4"},
        {"id": "u2", "codigo": "Apto 7"},
        {"id": "u3", "codigo": "Cozinha"},
        {"id": "u4", "codigo": "99"},
    ]
    sug = {s["unidadeId"]: s for s in sugerir_vinculos(meta["espacos"], unidades)}
    quarto = next(e for e in meta["espacos"] if e["nome"] == "4")
    galeria = next(e for e in meta["espacos"] if e["nome"] == "7")
    assert sug["u1"]["espacoGuid"] == quarto["guid"] and sug["u1"]["motivo"] == "codigo"
    assert sug["u2"]["espacoGuid"] == galeria["guid"]  # "Apto 7" → número 7
    assert "u3" not in sug and "u4" not in sug  # sem correspondência segura: fica para o ajuste manual


def test_vinculo_nao_repete_espaco():
    espacos = [{"guid": "g1", "nome": "101", "nome_longo": None}, {"guid": "g2", "nome": "102", "nome_longo": "Apto 102"}]
    sug = sugerir_vinculos(espacos, [{"id": "a", "codigo": "101"}, {"id": "b", "codigo": "Apto 101"}, {"id": "c", "codigo": "102"}])
    assert [s["espacoGuid"] for s in sug].count("g1") == 1
    assert {s["unidadeId"]: s["espacoGuid"] for s in sug}["c"] == "g2"


def test_ifc_invalido(tmp_path):
    ruim = tmp_path / "x.ifc"
    ruim.write_text("isto não é um IFC")
    with pytest.raises(ValueError, match="IFC"):
        ler_metadados(ruim)


def test_glb_le_e_regrava_mantendo_o_binario(glb, tmp_path):
    from imersa_bim.glb import gravar_glb

    _, destino = glb
    doc, binario = ler_glb(destino)
    doc["asset"]["generator"] = "teste"
    copia = tmp_path / "copia.glb"
    gravar_glb(copia, doc, binario)
    doc2, bin2 = ler_glb(copia)
    assert doc2["asset"]["generator"] == "teste" and bin2 == binario
    total = struct.unpack("<I", copia.read_bytes()[8:12])[0]
    assert total == copia.stat().st_size and total % 4 == 0
    json.dumps(doc2)
