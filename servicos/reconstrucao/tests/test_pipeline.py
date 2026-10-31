import json
import shutil
from pathlib import Path

import cv2
import numpy as np
import pytest

from imersa_recon.pipeline import ErroPipeline, Trabalho, executar
from imersa_recon.ply import escrever_ply_3dgs
from tests.test_validador import _foto

ROSTO = Path(__file__).parent / "fixtures" / "rosto-dominio-publico.jpg"


class KaggleFalso:
    """Simula o Kaggle: guarda o que recebeu e devolve um resultado pronto (ou um erro)."""

    def __init__(self, resultado: dict, com_ply: bool = True, status: list[str] | None = None):
        self.resultado, self.com_ply = resultado, com_ply
        self.status_seq = status or ["running", "complete"]
        self.datasets: list[Path] = []
        self.kernels: list[Path] = []

    def criar_dataset(self, pasta: Path) -> None:
        self.datasets.append(Path(shutil.copytree(pasta, pasta.parent / f"_recebido_{id(self)}_{len(self.datasets)}")))

    def dataset_pronto(self, id_dataset: str) -> bool:
        return True

    def dataset_existe(self, id_dataset: str) -> bool:
        return any(json.loads((d / "dataset-metadata.json").read_text())["id"] == id_dataset for d in self.datasets)

    def enviar_kernel(self, pasta: Path) -> None:
        self.kernels.append(Path(shutil.copytree(pasta, pasta.parent / f"_kernel_{id(self)}_{len(self.kernels)}")))

    def status(self, id_kernel: str) -> str:
        return self.status_seq.pop(0) if len(self.status_seq) > 1 else self.status_seq[0]

    def baixar_saida(self, id_kernel: str, destino: Path) -> None:
        destino.mkdir(parents=True, exist_ok=True)
        (destino / "resultado.json").write_text(json.dumps(self.resultado))
        if self.com_ply:
            n = 3000
            rnd = np.random.default_rng(0)
            q = np.tile([1, 0, 0, 0], (n, 1)).astype(np.float32)
            escrever_ply_3dgs(destino / "cena.ply", rnd.normal(size=(n, 3)).astype(np.float32), rnd.normal(size=(n, 3)).astype(np.float32), np.zeros((n, 45), np.float32), np.ones(n, np.float32), np.full((n, 3), -4, np.float32), q)


@pytest.fixture
def fotos(tmp_path: Path) -> Path:
    pasta = tmp_path / "fotos"
    pasta.mkdir()
    for i in range(24):
        cv2.imwrite(str(pasta / f"f{i:03d}.jpg"), _foto(i))
    # uma foto com rosto (em cima de uma foto da sequência)
    img = _foto(24)
    rosto = cv2.imread(str(ROSTO))
    img[100 : 100 + rosto.shape[0], 200 : 200 + rosto.shape[1]] = rosto
    cv2.imwrite(str(pasta / "f024.jpg"), img)
    return pasta


def _trabalho(tmp_path: Path) -> Trabalho:
    return Trabalho(id="cap-123", usuario="imersa", pasta=tmp_path / "trabalho", intervalo_s=0, limite_s=5)


def test_pipeline_completo_valida_desfoca_envia_privado_com_gpu_e_comprime(fotos: Path, tmp_path: Path):
    kaggle = KaggleFalso({"etapa": "pronto", "fotos": 25, "registradas": 25, "gaussianas": 3000, "psnr": 27.1, "tempos_s": {"treino": 600}})
    r = executar(fotos, _trabalho(tmp_path), kaggle)
    assert r.splat is not None and r.splat.suffix == ".sog" and r.splat.exists()
    assert r.metricas["gaussianas"] == 3000
    assert r.rostos_desfocados == 1

    # 1º envio: os pacotes (offline, reaproveitáveis) e depois as fotos da captura
    pacotes, dataset = kaggle.datasets
    assert json.loads((pacotes / "dataset-metadata.json").read_text())["id"] == "imersa/imersa-pacotes-py313-v1"
    assert any(p.name.startswith("pycolmap-4.2.1-cp313") for p in (pacotes / "rodas").iterdir())
    meta = json.loads((dataset / "dataset-metadata.json").read_text())
    assert meta["id"] == "imersa/imersa-cap-123"
    assert meta.get("isPrivate", True) is True
    assert json.loads((dataset / "config.json").read_text())["iteracoes"] == 7000
    assert (dataset / "codigo" / "imersa_recon" / "ply.py").exists()
    assert len(list((dataset / "fotos").glob("*.jpg"))) == 25
    from imersa_recon.rostos import detectar_rostos

    assert detectar_rostos(cv2.imread(str(dataset / "fotos" / "f024.jpg"))) == []  # nenhum rosto sai do servidor

    kernel = kaggle.kernels[0]
    km = json.loads((kernel / "kernel-metadata.json").read_text())
    assert km["id"] == "imersa/imersa-treino-cap-123"
    assert km["is_private"] is True and km["enable_gpu"] is True and km["enable_internet"] is True
    assert km["dataset_sources"] == ["imersa/imersa-cap-123", "imersa/imersa-pacotes-py313-v1"]
    assert (kernel / km["code_file"]).read_text(encoding="utf-8").startswith('"""\nFotos → 3D')


def test_fotos_ruins_param_antes_de_enviar_qualquer_coisa(tmp_path: Path):
    pasta = tmp_path / "poucas"
    pasta.mkdir()
    for i in range(5):
        cv2.imwrite(str(pasta / f"f{i}.jpg"), _foto(i))
    kaggle = KaggleFalso({})
    with pytest.raises(ErroPipeline) as e:
        executar(pasta, _trabalho(tmp_path), kaggle)
    assert e.value.codigo == "fotos_reprovadas"
    assert any("Poucas fotos" in p for p in e.value.detalhes)
    assert kaggle.datasets == [] and kaggle.kernels == []


def test_erro_do_colmap_na_nuvem_volta_com_a_mensagem_em_portugues(fotos: Path, tmp_path: Path):
    kaggle = KaggleFalso({"etapa": "erro", "erro": "poucas_fotos_encaixadas", "mensagem": "Só 40% das fotos se encaixaram no 3D"}, com_ply=False)
    with pytest.raises(ErroPipeline) as e:
        executar(fotos, _trabalho(tmp_path), kaggle)
    assert e.value.codigo == "poucas_fotos_encaixadas"
    assert "40%" in str(e.value)


def test_kernel_com_falha_ou_demorando_demais(fotos: Path, tmp_path: Path):
    with pytest.raises(ErroPipeline) as e:
        executar(fotos, _trabalho(tmp_path), KaggleFalso({}, com_ply=False, status=["running", "error"]))
    assert e.value.codigo == "falha_na_gpu"
    t = _trabalho(tmp_path)
    t.limite_s = 0
    with pytest.raises(ErroPipeline) as e:
        executar(fotos, t, KaggleFalso({}, status=["running"]))
    assert e.value.codigo == "tempo_esgotado"


def test_cameras_ja_calculadas_vao_junto_e_a_nuvem_pula_o_colmap(fotos: Path, tmp_path: Path):
    sparse = tmp_path / "sparse0"
    sparse.mkdir()
    (sparse / "cameras.bin").write_bytes(b"x")
    t = _trabalho(tmp_path)
    t.sparse = sparse
    kaggle = KaggleFalso({"etapa": "pronto"})
    executar(fotos, t, kaggle)
    assert (kaggle.datasets[-1] / "sparse" / "0" / "cameras.bin").read_bytes() == b"x"


def test_pacotes_sao_enviados_uma_vez_so(fotos: Path, tmp_path: Path):
    kaggle = KaggleFalso({"etapa": "pronto"})
    executar(fotos, _trabalho(tmp_path), kaggle)
    t2 = _trabalho(tmp_path)
    t2.id = "cap-456"
    executar(fotos, t2, kaggle)
    ids = [json.loads((d / "dataset-metadata.json").read_text())["id"] for d in kaggle.datasets]
    assert ids == ["imersa/imersa-pacotes-py313-v1", "imersa/imersa-cap-123", "imersa/imersa-cap-456"]
