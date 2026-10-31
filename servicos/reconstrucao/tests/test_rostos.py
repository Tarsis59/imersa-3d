from pathlib import Path

import cv2
import numpy as np

from imersa_recon.rostos import desfocar_rostos, detectar_rostos, processar_pasta

ROSTO = Path(__file__).parent / "fixtures" / "rosto-dominio-publico.jpg"


def test_detecta_o_rosto_e_depois_do_desfoque_nenhum_rosto_e_encontrado():
    img = cv2.imread(str(ROSTO))
    assert len(detectar_rostos(img)) == 1
    desfocada, n = desfocar_rostos(img)
    assert n == 1
    assert detectar_rostos(desfocada) == []
    assert desfocada.shape == img.shape


def test_foto_sem_rosto_sai_identica():
    rnd = np.random.default_rng(1)
    sala = cv2.resize(rnd.integers(0, 255, (60, 80, 3), dtype=np.uint8), (1600, 1200), interpolation=cv2.INTER_NEAREST)
    saida, n = desfocar_rostos(sala)
    assert n == 0
    assert np.array_equal(saida, sala)


def test_rosto_pequeno_numa_foto_grande_de_celular_tambem_e_desfocado():
    rosto = cv2.imread(str(ROSTO))
    grande = np.full((3000, 4000, 3), 180, np.uint8)
    grande[1500 : 1500 + rosto.shape[0], 2600 : 2600 + rosto.shape[1]] = rosto
    assert len(detectar_rostos(grande)) == 1
    desfocada, n = desfocar_rostos(grande)
    assert n == 1
    assert detectar_rostos(desfocada) == []
    # o resto da foto não muda
    assert np.array_equal(desfocada[:1000, :1000], grande[:1000, :1000])


def test_processar_pasta_grava_copias_sem_mexer_nos_originais(tmp_path: Path):
    entrada = tmp_path / "originais"
    entrada.mkdir()
    (entrada / "a.jpg").write_bytes(ROSTO.read_bytes())
    cv2.imwrite(str(entrada / "b.jpg"), np.full((800, 1000, 3), 120, np.uint8))
    (entrada / "leia.txt").write_text("não é foto")
    saida = tmp_path / "seguras"
    contagem = processar_pasta(entrada, saida)
    assert contagem == {"a.jpg": 1, "b.jpg": 0}
    assert sorted(p.name for p in saida.iterdir()) == ["a.jpg", "b.jpg"]
    assert (entrada / "a.jpg").read_bytes() == ROSTO.read_bytes()
    assert detectar_rostos(cv2.imread(str(saida / "a.jpg"))) == []
