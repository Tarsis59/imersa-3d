from imersa_recon.reconstruir import ZIP_TESTE
from tests.conjunto_rotulado import ZIP


def test_caminho_do_conjunto_de_teste_aponta_para_exemplos():
    assert ZIP_TESTE == ZIP
    assert ZIP_TESTE.parent.name == "fotos-para-reconstrucao"
