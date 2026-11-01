import json
import os
import shutil
import struct
import zipfile
from pathlib import Path

import cv2
import numpy as np
import pytest

from imersa_recon.giro import TrabalhoGiro, conferir_zip, executar, principal
from imersa_recon.pipeline import ErroPipeline


def _glb(tmp_path: Path, nos: list[dict]) -> Path:
    """GLB mínimo (só JSON, sem malha): basta para o orquestrador, que não abre a geometria."""
    js = json.dumps({"asset": {"version": "2.0"}, "nodes": nos}).encode()
    js += b" " * (-len(js) % 4)
    corpo = struct.pack("<II", len(js), 0x4E4F534A) + js
    p = tmp_path / "modelo.glb"
    p.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + len(corpo)) + corpo)
    return p


def _zip_giro(destino: Path, quadros: int, faltar: str | None = None) -> None:
    with zipfile.ZipFile(destino, "w") as z:
        z.writestr("giro.json", json.dumps({"quadros": quadros, "largura": 8, "altura": 4, "nos": [], "nos_sem_peca": [], "dispositivo": "OPTIX"}))
        for q in range(quadros):
            for nome in (f"cor_{q:03d}.jpg", f"mascara_{q:03d}.png"):
                if nome != faltar:
                    z.writestr(nome, b"x")


class KaggleFalso:
    def __init__(self, resultado: dict, zip_ok: bool = True, status: list[str] | None = None):
        self.resultado, self.zip_ok = resultado, zip_ok
        self.status_seq = status or ["running", "complete"]
        self.datasets: list[Path] = []
        self.kernels: list[Path] = []

    def criar_dataset(self, pasta: Path) -> None:
        self.datasets.append(Path(shutil.copytree(pasta, pasta.parent / f"_recebido_{id(self)}_{len(self.datasets)}")))

    def dataset_pronto(self, id_dataset: str) -> bool:
        return True

    def dataset_existe(self, id_dataset: str) -> bool:
        return True

    def enviar_kernel(self, pasta: Path) -> None:
        self.kernels.append(Path(shutil.copytree(pasta, pasta.parent / f"_kernel_{id(self)}_{len(self.kernels)}")))

    def status(self, id_kernel: str) -> str:
        return self.status_seq.pop(0) if len(self.status_seq) > 1 else self.status_seq[0]

    def baixar_saida(self, id_kernel: str, destino: Path) -> None:
        destino.mkdir(parents=True, exist_ok=True)
        (destino / "resultado.json").write_text(json.dumps(self.resultado))
        if self.resultado.get("etapa") == "pronto":
            _zip_giro(destino / "giro.zip", 3, None if self.zip_ok else "mascara_001.png")


CONFIG = {"quadros": 3, "largura": 8, "altura": 4, "amostras": 4}


def test_envia_modelo_e_roteiro_privados_e_devolve_o_zip(tmp_path: Path):
    glb = _glb(tmp_path, [{"name": "A"}])
    nuvem = KaggleFalso({"etapa": "pronto", "tempos_s": {"render": 12.5}})
    t = TrabalhoGiro(id="abc123", usuario="fulano", pasta=tmp_path / "t", intervalo_s=0)
    zip_, info = executar(glb, ["A"], CONFIG, t, nuvem)
    ds = nuvem.datasets[0]
    assert sorted(p.name for p in ds.iterdir()) == ["config.json", "dataset-metadata.json", "giro_blender.py", "modelo.glb", "nos.json"]
    assert json.loads((ds / "dataset-metadata.json").read_text()) == {"title": "imersa-giro-abc123", "id": "fulano/imersa-giro-abc123", "isPrivate": True, "licenses": [{"name": "other"}]}
    assert json.loads((ds / "nos.json").read_text()) == ["A"]
    meta = json.loads((nuvem.kernels[0] / "kernel-metadata.json").read_text())
    assert meta["is_private"] and meta["enable_gpu"] and meta["enable_internet"]
    assert meta["dataset_sources"] == ["fulano/imersa-giro-abc123"] and meta["code_file"] == "giro.py"
    # notebook com nome próprio: o Kaggle recusa (409) se for igual ao do dataset
    assert meta["id"] == "fulano/imersa-render-abc123" and meta["title"] == "imersa-render-abc123"
    assert (nuvem.kernels[0] / "giro.py").exists()
    assert zip_.exists() and info["quadros"] == 3 and info["dispositivo"] == "OPTIX" and info["tempos_s"] == {"render": 12.5}


def test_erros_da_nuvem_e_zip_incompleto(tmp_path: Path):
    glb = _glb(tmp_path, [])
    t = TrabalhoGiro(id="abc123", usuario="u", pasta=tmp_path / "t", intervalo_s=0)
    with pytest.raises(ErroPipeline) as e:
        executar(glb, [], CONFIG, t, KaggleFalso({"etapa": "erro", "erro": "sem_gpu", "mensagem": "sem GPU"}))
    assert e.value.codigo == "sem_gpu"
    with pytest.raises(ErroPipeline, match="falhou"):
        executar(glb, [], CONFIG, t, KaggleFalso({}, status=["error"]))
    with pytest.raises(ErroPipeline, match="incompleto") as e:
        executar(glb, [], CONFIG, t, KaggleFalso({"etapa": "pronto"}, zip_ok=False))
    assert e.value.detalhes == ["001"]
    falso = tmp_path / "falso.glb"
    falso.write_bytes(b"nada")
    with pytest.raises(ErroPipeline) as e:
        executar(falso, [], CONFIG, t, KaggleFalso({"etapa": "pronto"}))
    assert e.value.codigo == "modelo_invalido"


def test_zip_grande_demais(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import imersa_recon.giro as giro

    _zip_giro(tmp_path / "g.zip", 2)
    monkeypatch.setattr(giro, "MAX_ZIP_MB", 0)
    with pytest.raises(ErroPipeline) as e:
        conferir_zip(tmp_path / "g.zip", 2)
    assert e.value.codigo == "giro_grande_demais"


def test_linha_de_comando(tmp_path: Path):
    glb = _glb(tmp_path, [{"name": "A"}])
    (tmp_path / "nos.json").write_text('["A"]')
    r = tmp_path / "r.json"
    args = ["--glb", str(glb), "--nos", str(tmp_path / "nos.json"), "--id", "abc123", "--saida", str(tmp_path / "s"), "--resultado", str(r), "--usuario", "u", "--quadros", "3"]
    assert principal(args, KaggleFalso({"etapa": "pronto"})) == 0
    assert json.loads(r.read_text())["ok"] is True
    (tmp_path / "nos.json").write_text('{"A": 1}')
    assert principal(args, KaggleFalso({"etapa": "pronto"})) == 2
    assert json.loads(r.read_text())["erro"] == "entrada_invalida"
    with pytest.raises(SystemExit):
        principal([*args[:6], "--id", "Com Espaço", *args[8:]], KaggleFalso({}))


BLENDER = os.environ.get("IMERSA_BLENDER")
#: mais de 63 bytes: o Blender encurta o nome do objeto, e a unidade tem de ser achada mesmo assim
LONGO = "unidade-a-" + "x" * 70


@pytest.mark.skipif(not BLENDER, reason="defina IMERSA_BLENDER com o executável do Blender 4.2 para o render real")
def test_render_real_no_blender_mascaras_com_a_cor_id_exata(tmp_path: Path):
    """Dois cubos (unidades 0 e 1) + um terceiro sem unidade, render de verdade no Blender (CPU)."""
    glb = _cubos(tmp_path)
    (tmp_path / "nos.json").write_text(json.dumps([LONGO, "unidade-b"]))
    r = tmp_path / "r.json"
    args = ["--glb", str(glb), "--nos", str(tmp_path / "nos.json"), "--id", "teste1", "--saida", str(tmp_path / "s"), "--resultado", str(r)]
    codigo = principal([*args, "--blender", BLENDER, "--quadros", "4", "--largura", "96", "--altura", "54", "--amostras", "4"])
    info = json.loads(r.read_text())
    assert codigo == 0, info
    assert info["nos_sem_peca"] == []
    with zipfile.ZipFile(info["zip"]) as z:
        cores: set[int] = set()
        for q in range(4):
            m = cv2.imdecode(np.frombuffer(z.read(f"mascara_{q:03d}.png"), np.uint8), cv2.IMREAD_COLOR)[:, :, ::-1].astype(int)
            cores |= set(np.unique((m[:, :, 0] << 16) | (m[:, :, 1] << 8) | m[:, :, 2]).tolist())
            cor = cv2.imdecode(np.frombuffer(z.read(f"cor_{q:03d}.jpg"), np.uint8), cv2.IMREAD_COLOR)
            assert cor.shape == (54, 96, 3) and cor.std() > 5  # imagem de verdade, não um quadro liso
    # só preto e as cores-ID 1 (unidade-a) e 2 (unidade-b): nenhuma cor misturada nas bordas
    assert cores == {0, 1, 2}


def _cubos(tmp_path: Path) -> Path:
    """GLB com 3 cubos de 1 m lado a lado; o nome do 1º passa de 63 bytes (o Blender o encurtaria)."""
    v = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], np.float32)
    f = np.array([0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3], np.uint16)
    binario = v.tobytes() + f.tobytes()
    doc = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0, 1, 2]}],
        "nodes": [
            {"name": LONGO, "mesh": 0, "translation": [-1.5, 0, 0], "extras": {"ifc": "IfcSlab"}},
            {"name": "unidade-b", "mesh": 0, "translation": [0, 0, 0]},
            {"name": "parede", "mesh": 0, "translation": [1.5, 0, 0]},
        ],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 1]},
            {"bufferView": 1, "componentType": 5123, "count": 36, "type": "SCALAR"},
        ],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 96}, {"buffer": 0, "byteOffset": 96, "byteLength": 72}],
        "buffers": [{"byteLength": len(binario)}],
    }
    js = json.dumps(doc).encode()
    js += b" " * (-len(js) % 4)
    binario += b"\0" * (-len(binario) % 4)
    corpo = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binario), 0x004E4942) + binario
    p = tmp_path / "cubos.glb"
    p.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + len(corpo)) + corpo)
    return p
