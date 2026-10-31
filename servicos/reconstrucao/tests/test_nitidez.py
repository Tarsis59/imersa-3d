import cv2
import numpy as np

from imersa_recon.nitidez import nitidez, selecionar_quadros


def _xadrez(tamanho=256, casa=16):
    y, x = np.indices((tamanho, tamanho))
    return (((x // casa + y // casa) % 2) * 255).astype(np.uint8)


def test_imagem_nitida_tem_nota_maior_que_a_borrada():
    img = _xadrez()
    borrada = cv2.GaussianBlur(img, (0, 0), 6)
    assert nitidez(img) > 10 * nitidez(borrada)


def test_aceita_imagem_colorida():
    cor = cv2.cvtColor(_xadrez(), cv2.COLOR_GRAY2BGR)
    assert nitidez(cor) == nitidez(_xadrez())


def test_seleciona_o_mais_nitido_de_cada_trecho_e_mantem_a_ordem():
    notas = [1, 9, 2, 3, 3, 8, 7, 1, 1, 6]
    # 10 quadros em 3 trechos: [0..3], [4..6], [7..9]
    assert selecionar_quadros(notas, 3) == [1, 5, 9]


def test_trecho_todo_borrado_e_descartado():
    notas = [50, 60, 1, 2, 70, 80]
    assert selecionar_quadros(notas, 3, nota_minima=10) == [1, 5]


def test_pedir_mais_quadros_do_que_existem_devolve_todos_os_bons():
    assert selecionar_quadros([5, 6, 7], 10, nota_minima=6) == [1, 2]
    assert selecionar_quadros([], 5) == []
