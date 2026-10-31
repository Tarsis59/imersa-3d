import cv2
import numpy as np
import pytest

from imersa_recon.validador import avaliar
from tests.conjunto_rotulado import ZIP, Fotos, conjuntos


def _foto(i: int, lado: int = 1200, escura: bool = False, tremida: bool = False) -> np.ndarray:
    """Cena sintética com textura que anda um pouco a cada foto (como passos curtos)."""
    rnd = np.random.default_rng(42)
    base = cv2.resize(rnd.integers(0, 255, (90, 120), dtype=np.uint8), (lado, lado * 3 // 4), interpolation=cv2.INTER_NEAREST)
    img = cv2.cvtColor(np.roll(base, i * 12, axis=1), cv2.COLOR_GRAY2BGR)
    if tremida:
        img = cv2.GaussianBlur(img, (0, 0), 8)
    if escura:
        img = (img * 0.1).astype(np.uint8)
    return img


def test_conjunto_bom_passa_sem_problemas():
    r = avaliar([_foto(i) for i in range(25)])
    assert r.aprovado, r.problemas
    assert r.metricas["fotos"] == 25


def test_poucas_fotos_tem_mensagem_clara():
    r = avaliar([_foto(i) for i in range(5)])
    assert not r.aprovado
    assert any("Poucas fotos (5)" in p for p in r.problemas)


def test_tremidas_escuras_e_baixa_resolucao_viram_problemas_em_portugues():
    r = avaliar([_foto(i, tremida=i % 2 == 0) for i in range(24)])
    assert any("tremidas ou fora de foco" in p for p in r.problemas)
    r = avaliar([_foto(i, escura=i % 3 != 0) for i in range(24)])
    assert any("escuras demais ou estouradas" in p for p in r.problemas)
    r = avaliar([_foto(i, lado=600) for i in range(24)])
    assert any("resolução baixa" in p for p in r.problemas)


def test_nenhuma_foto():
    r = avaliar([])
    assert not r.aprovado


@pytest.mark.skipif(not ZIP.exists(), reason="conjunto de fotos reais não baixado")
def test_acerto_no_conjunto_rotulado_de_fotos_reais_e_de_pelo_menos_90_porcento():
    f = Fotos()
    resultados = [(nome, avaliar(imgs), esperado) for nome, imgs, esperado in conjuntos(f)]
    acertos = sum(r.aprovado == esperado for _, r, esperado in resultados)
    assert acertos / len(resultados) >= 0.9, [(n, r.metricas) for n, r, e in resultados if r.aprovado != e]
    # todo conjunto bom passa (não barrar a consultora à toa)
    assert all(r.aprovado for _, r, esperado in resultados if esperado)
    # o que escapa por sobreposição pelo menos recebe o aviso (e o COLMAP barra antes do treino)
    for nome, r, esperado in resultados:
        if not esperado and r.aprovado:
            assert any("se encaixam" in a for a in r.avisos), nome
