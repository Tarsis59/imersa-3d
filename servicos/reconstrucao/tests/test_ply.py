import shutil
from pathlib import Path

import numpy as np
import pytest

from imersa_recon.compressao import comprimir
from imersa_recon.ply import ler_ply_3dgs, propriedades, escrever_ply_3dgs


def _gaussianas(n=500, sh=3, seed=0):
    rnd = np.random.default_rng(seed)
    q = rnd.normal(size=(n, 4)).astype(np.float32)
    return dict(
        xyz=rnd.uniform(-2, 2, (n, 3)).astype(np.float32),
        f_dc=rnd.normal(size=(n, 3)).astype(np.float32),
        f_rest=rnd.normal(scale=0.1, size=(n, 3 * ((sh + 1) ** 2 - 1))).astype(np.float32),
        opacidade=rnd.normal(size=n).astype(np.float32),
        escala=rnd.uniform(-5, -2, (n, 3)).astype(np.float32),
        rotacao=(q / np.linalg.norm(q, axis=1, keepdims=True)).astype(np.float32),
    )


def test_nomes_das_propriedades_no_padrao_do_3dgs():
    p = propriedades(3)
    assert p[:6] == ["x", "y", "z", "nx", "ny", "nz"]
    assert p[6:9] == ["f_dc_0", "f_dc_1", "f_dc_2"]
    assert p[9] == "f_rest_0" and p[53] == "f_rest_44"
    assert p[-8:] == ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    assert len(propriedades(0)) == 6 + 3 + 0 + 1 + 3 + 4


def test_ida_e_volta_sem_perda(tmp_path: Path):
    g = _gaussianas()
    caminho = tmp_path / "cena.ply"
    escrever_ply_3dgs(caminho, **g)
    assert caminho.read_bytes().startswith(b"ply\nformat binary_little_endian 1.0\nelement vertex 500\n")
    lido = ler_ply_3dgs(caminho)
    for k, v in g.items():
        assert np.array_equal(lido[k], v), k


def test_formatos_inconsistentes_sao_recusados(tmp_path: Path):
    g = _gaussianas(10)
    g["escala"] = g["escala"][:5]
    with pytest.raises(ValueError, match="escala"):
        escrever_ply_3dgs(tmp_path / "x.ply", **g)


@pytest.mark.skipif(shutil.which("npx") is None, reason="Node/npx não instalado")
@pytest.mark.parametrize("formato", ["sog", "spz"])
def test_comprime_com_splat_transform_e_fica_menor(tmp_path: Path, formato: str):
    g = _gaussianas(20_000, seed=1)
    ply = tmp_path / "cena.ply"
    escrever_ply_3dgs(ply, **g)
    saida = comprimir(ply, tmp_path / f"cena.{formato}")
    assert saida.exists()
    assert saida.stat().st_size < ply.stat().st_size / 4
