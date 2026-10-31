import io
import zipfile
from pathlib import Path

import cv2
import numpy as np
import pytest

from imersa_recon.entrada import ErroEntrada, extrair_zip


def _jpg() -> bytes:
    ok, b = cv2.imencode(".jpg", np.full((40, 60, 3), 128, np.uint8))
    return b.tobytes()


def _zip(tmp_path: Path, arquivos: dict[str, bytes]) -> Path:
    caminho = tmp_path / "fotos.zip"
    with zipfile.ZipFile(caminho, "w") as z:
        for nome, dados in arquivos.items():
            z.writestr(nome, dados)
    return caminho


def test_extrai_so_as_fotos_e_achata_as_pastas(tmp_path: Path):
    z = _zip(tmp_path, {"sala/IMG_001.jpg": _jpg(), "sala/IMG_002.JPEG": _jpg(), "leia.txt": b"x", "__MACOSX/._IMG_001.jpg": b"lixo", "pasta/": b""})
    fotos = extrair_zip(z, tmp_path / "saida")
    assert [p.name for p in fotos] == ["IMG_001.jpg", "IMG_002.JPEG"]


def test_zip_slip_nao_escreve_fora_da_pasta(tmp_path: Path):
    z = _zip(tmp_path, {"../../fora.jpg": _jpg(), "C:/Windows/x.jpg": _jpg()})
    saida = tmp_path / "saida"
    fotos = extrair_zip(z, saida)
    assert all(p.parent == saida for p in fotos)
    assert not (tmp_path / "fora.jpg").exists()


def test_nomes_repetidos_em_pastas_diferentes_nao_se_sobrescrevem(tmp_path: Path):
    z = _zip(tmp_path, {"a/IMG.jpg": _jpg(), "b/IMG.jpg": _jpg()})
    assert len(extrair_zip(z, tmp_path / "saida")) == 2


def test_zip_bomba_e_recusado_antes_de_descompactar(tmp_path: Path):
    caminho = tmp_path / "bomba.zip"
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("grande.jpg", b"\0" * (60 * 1024 * 1024))
    with pytest.raises(ErroEntrada, match="grande demais"):
        extrair_zip(caminho, tmp_path / "saida", max_bytes_foto=50 * 1024 * 1024)


def test_muitas_fotos_ou_zip_invalido(tmp_path: Path):
    z = _zip(tmp_path, {f"f{i}.jpg": b"x" for i in range(12)})
    with pytest.raises(ErroEntrada, match="fotos demais"):
        extrair_zip(z, tmp_path / "s", max_fotos=10)
    lixo = tmp_path / "lixo.zip"
    lixo.write_bytes(b"nao e zip")
    with pytest.raises(ErroEntrada, match="não é um ZIP válido"):
        extrair_zip(lixo, tmp_path / "s2")
    vazio = _zip(tmp_path, {"leia.txt": b"x"})
    with pytest.raises(ErroEntrada, match="nenhuma foto"):
        extrair_zip(vazio, tmp_path / "s3")
