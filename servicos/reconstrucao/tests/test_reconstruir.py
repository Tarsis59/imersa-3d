from imersa_recon.reconstruir import ZIP_TESTE
from tests.conjunto_rotulado import ZIP


def test_caminho_do_conjunto_de_teste_aponta_para_exemplos():
    assert ZIP_TESTE == ZIP
    assert ZIP_TESTE.parent.name == "fotos-para-reconstrucao"


import json
import zipfile
from pathlib import Path

import cv2

from imersa_recon.reconstruir import principal
from tests.test_pipeline import KaggleFalso
from tests.test_validador import _foto


def test_zip_de_fotos_de_ponta_a_ponta_grava_o_resultado_para_o_worker(tmp_path: Path):
    z = tmp_path / "fotos.zip"
    with zipfile.ZipFile(z, "w") as arq:
        for i in range(24):
            arq.writestr(f"celular/IMG_{i:03d}.jpg", cv2.imencode(".jpg", _foto(i))[1].tobytes())
    saida = tmp_path / "res.json"
    codigo = principal(["--zip", str(z), "--id", "cap-1", "--usuario", "imersa", "--trabalho", str(tmp_path / "t"), "--resultado", str(saida)], nuvem=KaggleFalso({"etapa": "pronto", "psnr": 26.0}))
    r = json.loads(saida.read_text(encoding="utf-8"))
    assert codigo == 0 and r["ok"] is True
    assert r["splat"].endswith(".sog") and Path(r["splat"]).exists()


def test_zip_invalido_vira_resultado_com_mensagem(tmp_path: Path):
    z = tmp_path / "x.zip"
    z.write_bytes(b"lixo")
    saida = tmp_path / "res.json"
    assert principal(["--zip", str(z), "--usuario", "imersa", "--trabalho", str(tmp_path / "t"), "--resultado", str(saida)], nuvem=KaggleFalso({})) == 2
    r = json.loads(saida.read_text(encoding="utf-8"))
    assert r == {"ok": False, "erro": "entrada_invalida", "mensagem": "o arquivo enviado não é um ZIP válido", "detalhes": []}
