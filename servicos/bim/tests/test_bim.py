import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from imersa_bim.converter import converter
from imersa_bim.glb import ler_glb
from imersa_bim.metadados import ler_metadados

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
    # telhado da FZK: lajes ROOF dentro de um IfcRoof (o configurador separa telhado de piso por isso)
    lajes = [n["extras"] for n in doc["nodes"] if n.get("extras", {}).get("ifc") == "IfcSlab"]
    assert any(x.get("ifcTipo") == "ROOF" or x.get("ifcPai") == "IfcRoof" for x in lajes)
    assert any(x.get("ifcTipo") in ("FLOOR", "BASESLAB") and x.get("ifcPai") != "IfcRoof" for x in lajes)
    espaco = next(n for n in doc["nodes"] if n.get("extras", {}).get("ifc") == "IfcSpace")
    assert espaco["extras"]["areaM2"] > 0
    # glTF é Y para cima: a casa tem ~6-9 m de altura em Y e se espalha em X/Z
    minimo, maximo = caixa_mundo(doc)
    altura = maximo[1] - minimo[1]
    assert 5 < altura < 10
    assert maximo[0] - minimo[0] > altura and maximo[2] - minimo[2] > altura


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


@pytest.mark.skipif(not shutil.which("npx"), reason="Node.js (npx) não encontrado")
def test_otimizado_fica_com_no_maximo_30_por_cento_e_mantem_nomes_e_tipos(glb, tmp_path):
    from imersa_bim.otimizar import otimizar

    _, destino = glb
    saida = otimizar(destino, tmp_path / "casa-otimizada.glb")
    assert saida.stat().st_size <= 0.30 * destino.stat().st_size
    original, _ = ler_glb(destino)
    novo, _ = ler_glb(saida)
    assert "EXT_meshopt_compression" in novo.get("extensionsUsed", [])
    # o nome (GlobalId) e o tipo IFC de cada peça sobrevivem: são o vínculo com as unidades
    antes = {n["name"]: n.get("extras") for n in original["nodes"] if n.get("name")}
    depois = {n["name"]: n.get("extras") for n in novo["nodes"] if n.get("name")}
    assert depois == antes


@pytest.mark.skipif(not shutil.which("npx"), reason="Node.js (npx) não encontrado")
def test_linha_de_comando_grava_resultado(tmp_path):
    glb, resultado = tmp_path / "saida.glb", tmp_path / "resultado.json"
    r = subprocess.run([sys.executable, "-m", "imersa_bim", "--ifc", str(FZK), "--glb", str(glb), "--resultado", str(resultado)], capture_output=True, text=True, cwd=Path(__file__).parents[1])
    assert r.returncode == 0, r.stderr
    dados = json.loads(resultado.read_text(encoding="utf-8"))
    assert dados["ok"] is True
    assert dados["elementos"] == 107 and len(dados["metadados"]["espacos"]) == 7
    assert dados["bytesOriginal"] > dados["bytes"] == glb.stat().st_size


def test_linha_de_comando_ifc_ruim(tmp_path):
    ruim, resultado = tmp_path / "x.ifc", tmp_path / "r.json"
    ruim.write_text("nada")
    r = subprocess.run([sys.executable, "-m", "imersa_bim", "--ifc", str(ruim), "--glb", str(tmp_path / "s.glb"), "--resultado", str(resultado)], capture_output=True, text=True, cwd=Path(__file__).parents[1])
    assert r.returncode == 1
    assert json.loads(resultado.read_text(encoding="utf-8")) == {"ok": False, "erro": "ifc_invalido", "mensagem": "O arquivo não é um IFC válido."}
