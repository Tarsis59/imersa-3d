import subprocess
from pathlib import Path

import pytest

from imersa_recon import compressao


def _falso(chamadas: list[list[str]], falhar_gpu: bool):
    """Simula o splat-transform: o .sog precisa da GPU local (falha sem placa/driver); o .spz roda na CPU."""

    def run(comando, **_):
        chamadas.append(comando)
        if falhar_gpu and comando[-1].endswith(".sog"):
            return subprocess.CompletedProcess(comando, 1, "", "WebgpuGraphicsDevice.createDevice D3DError")
        Path(comando[-1]).write_bytes(b"ok")
        return subprocess.CompletedProcess(comando, 0, "", "")

    return run


@pytest.fixture
def ambiente(monkeypatch, tmp_path):
    monkeypatch.setattr(compressao.shutil, "which", lambda _: "npx")
    entrada = tmp_path / "cena.ply"
    entrada.write_bytes(b"ply")
    return entrada


def test_sem_gpu_local_entrega_spz(monkeypatch, ambiente, tmp_path):
    """SOG na CPU leva mais de 30 min num splat real; SPZ fica do mesmo tamanho em segundos e o visualizador abre os dois."""
    chamadas: list[list[str]] = []
    monkeypatch.setattr(compressao.subprocess, "run", _falso(chamadas, falhar_gpu=True))
    saida = compressao.comprimir(ambiente, tmp_path / "cena.sog")
    assert saida == tmp_path / "cena.spz"
    assert saida.read_bytes() == b"ok"
    assert [c[-1] for c in chamadas] == [str(tmp_path / "cena.sog"), str(tmp_path / "cena.spz")]


def test_com_gpu_local_roda_uma_vez(monkeypatch, ambiente, tmp_path):
    chamadas: list[list[str]] = []
    monkeypatch.setattr(compressao.subprocess, "run", _falso(chamadas, falhar_gpu=False))
    compressao.comprimir(ambiente, tmp_path / "cena.sog")
    assert len(chamadas) == 1


def test_falha_na_cpu_tambem_avisa(monkeypatch, ambiente, tmp_path):
    def run(comando, **_):
        return subprocess.CompletedProcess(comando, 1, "", "arquivo corrompido")

    monkeypatch.setattr(compressao.subprocess, "run", run)
    with pytest.raises(RuntimeError, match="arquivo corrompido"):
        compressao.comprimir(ambiente, tmp_path / "cena.sog")
