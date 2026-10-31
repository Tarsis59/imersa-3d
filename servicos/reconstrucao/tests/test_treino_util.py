import numpy as np
import pytest

from imersa_recon.ply import escrever_ply_3dgs, ler_ply_3dgs
from imersa_recon.treino_util import (
    C0,
    MIN_FRACAO_REGISTRADA,
    avaliar_registro,
    escala_da_cena,
    escolher_pareamento,
    f_rest_para_ply,
    indice_gsplat,
    k_redimensionado,
    rgb_para_sh0,
    viewmat,
)


def test_pareamento_exaustivo_ate_80_fotos_e_sequencial_acima():
    assert escolher_pareamento(30) == "exaustivo"
    assert escolher_pareamento(80) == "exaustivo"
    assert escolher_pareamento(81) == "sequencial"


def test_registro_abaixo_de_70_por_cento_para_antes_do_treino_com_mensagem_clara():
    ok, msg = avaliar_registro(registradas=90, total=100)
    assert ok and msg is None
    ok, msg = avaliar_registro(registradas=60, total=100)
    assert not ok and "60%" in msg and "passos curtos" in msg
    assert MIN_FRACAO_REGISTRADA == 0.7
    assert avaliar_registro(0, 0)[0] is False


def test_escala_da_cena_e_o_raio_das_cameras_com_folga():
    centros = np.array([[0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 0]], float)
    assert escala_da_cena(centros) == pytest.approx(np.sqrt(2) * 1.1)


def test_k_ao_reduzir_a_foto_escala_focal_e_centro():
    K = np.array([[1000, 0, 800], [0, 1000, 600], [0, 0, 1]], float)
    np.testing.assert_allclose(k_redimensionado(K, 0.5), [[500, 0, 400], [0, 500, 300], [0, 0, 1]])


def test_viewmat_4x4_a_partir_de_3x4():
    m = np.hstack([np.eye(3), [[1], [2], [3]]])
    v = viewmat(m)
    assert v.shape == (4, 4)
    np.testing.assert_allclose(v[3], [0, 0, 0, 1])
    np.testing.assert_allclose(v[:3, 3], [1, 2, 3])


def test_cor_para_sh0_e_volta():
    rgb = np.array([[0.0, 0.5, 1.0]])
    np.testing.assert_allclose(rgb_para_sh0(rgb) * C0 + 0.5, rgb)


def test_shN_vira_f_rest_no_layout_do_3dgs_por_canal():
    shN = np.arange(2 * 15 * 3, dtype=np.float32).reshape(2, 15, 3)  # [N, coeficiente, canal]
    f = f_rest_para_ply(shN)
    assert f.shape == (2, 45)
    np.testing.assert_array_equal(f[0, :15], shN[0, :, 0])  # todos os coeficientes do R
    np.testing.assert_array_equal(f[0, 15:30], shN[0, :, 1])  # depois G
    # e o PLY aceita
    n = 2
    q = np.tile([1, 0, 0, 0], (n, 1)).astype(np.float32)
    escrever_ply_3dgs(__import__("pathlib").Path("trabalho/_t.ply"), np.zeros((n, 3), np.float32), np.zeros((n, 3), np.float32), f, np.zeros(n, np.float32), np.zeros((n, 3), np.float32), q)
    assert ler_ply_3dgs(__import__("pathlib").Path("trabalho/_t.ply"))["f_rest"].shape == (2, 45)


def test_indice_do_gsplat_pre_compilado():
    assert indice_gsplat("2.4.1+cu124", "12.4") == "https://docs.gsplat.studio/whl/pt24cu124"
    assert indice_gsplat("2.6.0", None) is None
