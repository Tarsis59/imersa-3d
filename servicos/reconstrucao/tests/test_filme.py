import json
import os
import shutil
from pathlib import Path

import cv2
import pytest

from imersa_recon.filme import SELO, TrabalhoVideo, executar, principal
from imersa_recon.pipeline import ErroPipeline
from tests.test_giro import LONGO, _cubos, _glb

CONFIG = {"formato": "9:16", "segundos": 1.0, "fps": 6, "amostras": 4, "selo": SELO}
MP4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64


#: nome único por cópia (o id() de objeto já coletado pode se repetir e colidir na mesma pasta)
_COPIAS = iter(range(10**6))


class KaggleFalso:
    def __init__(self, resultado: dict, info: dict | None = None):
        self.resultado, self.info = resultado, info
        self.datasets: list[Path] = []
        self.kernels: list[Path] = []

    def criar_dataset(self, pasta: Path) -> None:
        self.datasets.append(Path(shutil.copytree(pasta, pasta.parent / f"_recebido_{next(_COPIAS)}")))

    def dataset_pronto(self, id_dataset: str) -> bool:
        return True

    def dataset_existe(self, id_dataset: str) -> bool:
        return True

    def enviar_kernel(self, pasta: Path) -> None:
        self.kernels.append(Path(shutil.copytree(pasta, pasta.parent / f"_kernel_{next(_COPIAS)}")))

    def status(self, id_kernel: str) -> str:
        return "complete"

    def baixar_saida(self, id_kernel: str, destino: Path) -> None:
        destino.mkdir(parents=True, exist_ok=True)
        (destino / "resultado.json").write_text(json.dumps(self.resultado))
        if self.info is not None:
            (destino / "video.mp4").write_bytes(MP4)
            (destino / "capa.jpg").write_bytes(b"\xff\xd8")
            (destino / "video.json").write_text(json.dumps(self.info))


def test_envia_privado_e_confere_formato_e_selo(tmp_path: Path):
    glb = _glb(tmp_path, [{"name": "A"}])
    nuvem = KaggleFalso({"etapa": "pronto", "tempos_s": {"render": 600}}, {"formato": "9:16", "selo": SELO, "dispositivo": "OPTIX", "segundos": 10})
    pasta, info = executar(glb, CONFIG, TrabalhoVideo(id="abc123", usuario="fulano", pasta=tmp_path / "t", intervalo_s=0), nuvem)
    ds = nuvem.datasets[0]
    assert sorted(p.name for p in ds.iterdir()) == ["config.json", "dataset-metadata.json", "modelo.glb", "narracao.py", "video_blender.py"]
    assert json.loads((ds / "dataset-metadata.json").read_text())["isPrivate"] is True
    assert json.loads((ds / "config.json").read_text())["selo"] == "Imagem ilustrativa"
    meta = json.loads((nuvem.kernels[0] / "kernel-metadata.json").read_text())
    assert meta["is_private"] and meta["enable_gpu"] and meta["id"] == "fulano/imersa-filme-abc123" and meta["dataset_sources"] == ["fulano/imersa-video-abc123"]
    # o notebook roda o roteiro do vídeo (não o do giro)
    assert meta["code_file"] == "video.py" and (nuvem.kernels[0] / "video.py").exists() and not (nuvem.kernels[0] / "giro.py").exists()
    assert (pasta / "video.mp4").exists() and info["capa"] is True and info["dispositivo"] == "OPTIX" and info["tempos_s"] == {"render": 600}


def test_sem_selo_ou_formato_errado_nao_passa(tmp_path: Path):
    glb = _glb(tmp_path, [])
    t = TrabalhoVideo(id="abc123", usuario="u", pasta=tmp_path / "t", intervalo_s=0)
    with pytest.raises(ErroPipeline, match="selo"):
        executar(glb, CONFIG, t, KaggleFalso({"etapa": "pronto"}, {"formato": "9:16", "selo": ""}))
    with pytest.raises(ErroPipeline, match="selo"):
        executar(glb, CONFIG, t, KaggleFalso({"etapa": "pronto"}, {"formato": "1:1", "selo": SELO}))
    with pytest.raises(ErroPipeline) as e:
        executar(glb, CONFIG, t, KaggleFalso({"etapa": "erro", "erro": "sem_gpu", "mensagem": "x"}))
    assert e.value.codigo == "sem_gpu"


def test_narracao_vai_no_pedido_e_o_video_sem_ela_nao_passa(tmp_path: Path):
    glb = _glb(tmp_path, [])
    config = {**CONFIG, "narracao": {"texto": "Conheça o Residencial Paulista.", "voz": "pf_dora"}}
    t = TrabalhoVideo(id="abc123", usuario="u", pasta=tmp_path / "t", intervalo_s=0)
    info = {"formato": "9:16", "selo": SELO, "dispositivo": "OPTIX"}
    with pytest.raises(ErroPipeline) as e:
        executar(glb, config, t, KaggleFalso({"etapa": "pronto"}, info))
    assert e.value.codigo == "falha_na_narracao"
    nuvem = KaggleFalso({"etapa": "pronto"}, {**info, "narracao": {"voz": "pf_dora", "segundos": 6.2, "frases": 2, "legenda": "queimada"}})
    _, ok = executar(glb, config, TrabalhoVideo(id="abc124", usuario="u", pasta=tmp_path / "t2", intervalo_s=0), nuvem)
    assert ok["narracao"]["legenda"] == "queimada"
    assert json.loads((nuvem.datasets[0] / "config.json").read_text())["narracao"]["voz"] == "pf_dora"


def test_pedido_de_narracao_invalido(tmp_path: Path):
    glb = _glb(tmp_path, [])
    pedido = tmp_path / "n.json"
    resultado = tmp_path / "r.json"
    for ruim in ({"texto": "curto", "voz": "pf_dora"}, {"texto": "Um texto bom o bastante.", "voz": "robo"}):
        pedido.write_text(json.dumps(ruim))
        codigo = principal(["--glb", str(glb), "--formato", "9:16", "--id", "abc123", "--saida", str(tmp_path / "s"), "--resultado", str(resultado), "--usuario", "u", "--narracao", str(pedido)])
        assert codigo == 2 and json.loads(resultado.read_text())["erro"] == "entrada_invalida"


BLENDER = os.environ.get("IMERSA_BLENDER")


@pytest.mark.skipif(not BLENDER, reason="defina IMERSA_BLENDER com o executável do Blender 4.2 para o render real")
@pytest.mark.parametrize("formato,proporcao", [("9:16", 16 / 9), ("1:1", 1.0)])
def test_render_real_mp4_h264_no_formato_com_selo(tmp_path: Path, formato: str, proporcao: float):
    glb = _cubos(tmp_path)
    r = tmp_path / "r.json"
    args = ["--glb", str(glb), "--formato", formato, "--id", "teste1", "--saida", str(tmp_path / "s"), "--resultado", str(r)]
    codigo = principal([*args, "--blender", BLENDER, "--segundos", "0.5", "--fps", "8", "--amostras", "4", "--escala", "20"])
    info = json.loads(r.read_text())
    assert codigo == 0, info
    assert info["selo"] == "Imagem ilustrativa" and info["capa"]
    v = cv2.VideoCapture(info["video"])
    quadros = []
    while True:
        ok, q = v.read()
        if not ok:
            break
        quadros.append(q)
    assert len(quadros) == 4
    alt, larg = quadros[0].shape[:2]
    assert abs(alt / larg - proporcao) < 0.02
    assert int(v.get(cv2.CAP_PROP_FOURCC)).to_bytes(4, "little") in (b"h264", b"avc1")
    # selo: caixa escura com letra clara no canto de baixo à esquerda (o resto da imagem é céu e chão claros)
    canto = quadros[-1][int(alt * 0.9) :, : int(larg * 0.5)]
    assert canto.min() < 120 and canto.max() > 200
    assert LONGO  # (mesmo GLB de teste do giro)
