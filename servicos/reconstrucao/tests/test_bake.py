import json
import os
import shutil
import struct
from pathlib import Path

import numpy as np
import pytest

from imersa_recon.bake import TrabalhoBake, _ler_glb, anexar_lightmaps_no_glb, conferir_glb, executar, principal
from imersa_recon.pipeline import ErroPipeline


def _glb_json_only(doc: dict) -> bytes:
    """GLB só com o bloco JSON (sem malha): basta para testar quem só olha para `materials`/`extras`."""
    js = json.dumps(doc).encode()
    js += b" " * (-len(js) % 4)
    corpo = struct.pack("<II", len(js), 0x4E4F534A) + js
    return b"glTF" + struct.pack("<II", 2, 12 + len(corpo)) + corpo


def _cubo(tmp_path: Path) -> Path:
    """GLB com 1 cubo (1 m lado), 1 material, UV0 e um bloco BIN de verdade."""
    v = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], np.float32)
    f = np.array([0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3], np.uint16)
    uv = np.tile(np.array([[0, 0], [1, 0], [0, 1], [1, 1]], np.float32), (6, 1))[: len(v)]
    binario = v.tobytes() + f.tobytes()
    doc = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "fachada", "mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "TEXCOORD_0": 2}, "indices": 1, "material": 0}]}],
        # metallicFactor explícito: o padrão do glTF é 1.0 (metal puro, sem componente difusa) — o cubo do teste
        # precisa ser dielétrico para o bake de luz difusa (dia/noite) ter algo para medir
        "materials": [{"name": "concreto", "pbrMetallicRoughness": {"baseColorFactor": [0.7, 0.7, 0.7, 1], "metallicFactor": 0.0, "roughnessFactor": 0.8}}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 1]},
            {"bufferView": 1, "componentType": 5123, "count": 36, "type": "SCALAR"},
            {"bufferView": 2, "componentType": 5126, "count": 8, "type": "VEC2"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 96},
            {"buffer": 0, "byteOffset": 96, "byteLength": 72},
            {"buffer": 0, "byteOffset": 168, "byteLength": 64},
        ],
        "buffers": [{"byteLength": len(binario) + len(uv.tobytes())}],
    }
    binario += uv.tobytes()
    js = json.dumps(doc).encode()
    js += b" " * (-len(js) % 4)
    binario += b"\0" * (-len(binario) % 4)
    corpo = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binario), 0x004E4942) + binario
    p = tmp_path / "cubo.glb"
    p.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + len(corpo)) + corpo)
    return p


class KaggleFalso:
    def __init__(self, resultado: dict, completo: bool = True, status: list[str] | None = None):
        self.resultado, self.completo = resultado, completo
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
        if self.resultado.get("etapa") != "pronto":
            return
        (destino / "baseline.glb").write_bytes(_glb_json_only({"asset": {"version": "2.0"}, "materials": [{"name": "concreto"}]}))
        if self.completo:
            (destino / "ao.png").write_bytes(b"AO-PNG-FALSO")
            (destino / "dia.png").write_bytes(b"DIA-PNG-FALSO")
            (destino / "noite.png").write_bytes(b"NOITE-PNG-FALSO")


CONFIG = {"largura": 8, "amostras": 4}


def test_anexa_as_3_texturas_e_marca_os_materiais_sem_perder_os_extras_que_ja_existiam():
    glb = _glb_json_only({"asset": {"version": "2.0"}, "materials": [{"name": "concreto"}, {"name": "vidro", "extras": {"outra_coisa": 1}}]})
    assado = anexar_lightmaps_no_glb(glb, b"AO-BYTES", b"DIA-BYTES-MAIOR", b"NOITE-BYTES")
    doc, binario = _ler_glb(assado)
    assert len(doc["materials"]) == 2
    idx_dia = idx_noite = None
    for m in doc["materials"]:
        assert m["occlusionTexture"]["texCoord"] == 1
        assert isinstance(m["occlusionTexture"]["index"], int)
        idx_dia, idx_noite = m["extras"]["imersa_lightmap_dia"], m["extras"]["imersa_lightmap_noite"]
    # o material que já tinha extras continua com eles, só ganha os dois novos
    assert doc["materials"][1]["extras"]["outra_coisa"] == 1

    def bytes_da_textura(indice: int) -> bytes:
        tex = doc["textures"][indice]
        img = doc["images"][tex["source"]]
        bv = doc["bufferViews"][img["bufferView"]]
        return binario[bv["byteOffset"] : bv["byteOffset"] + bv["byteLength"]]

    idx_ao = doc["materials"][0]["occlusionTexture"]["index"]
    assert bytes_da_textura(idx_ao) == b"AO-BYTES"
    assert bytes_da_textura(idx_dia) == b"DIA-BYTES-MAIOR"
    assert bytes_da_textura(idx_noite) == b"NOITE-BYTES"
    # o comprimento declarado é o dos dados (pode ser menor que o bloco BIN, alinhado a 4 bytes pelo GLB)
    assert doc["buffers"][0]["byteLength"] == len(b"AO-BYTES" + b"DIA-BYTES-MAIOR" + b"\x00" + b"NOITE-BYTES")
    assert len(binario) >= doc["buffers"][0]["byteLength"]


def test_sem_materiais_nenhum_e_glb_invalido_viram_erro():
    with pytest.raises(ErroPipeline, match="material"):
        anexar_lightmaps_no_glb(_glb_json_only({"asset": {"version": "2.0"}}), b"a", b"b", b"c")
    with pytest.raises(ErroPipeline):
        anexar_lightmaps_no_glb(b"nao e glb", b"a", b"b", b"c")


def test_glb_grande_demais(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import imersa_recon.bake as bake

    p = tmp_path / "g.glb"
    p.write_bytes(_glb_json_only({"asset": {"version": "2.0"}}))
    monkeypatch.setattr(bake, "MAX_GLB_MB", 0)
    with pytest.raises(ErroPipeline) as e:
        conferir_glb(p)
    assert e.value.codigo == "bake_grande_demais"


def test_envia_modelo_e_roteiro_privados_e_devolve_o_glb_assado(tmp_path: Path):
    glb = tmp_path / "modelo.glb"
    glb.write_bytes(_glb_json_only({"asset": {"version": "2.0"}}))
    nuvem = KaggleFalso({"etapa": "pronto", "dispositivo": "OPTIX", "tempos_s": {"bake": 42.0}})
    t = TrabalhoBake(id="abc123", usuario="fulano", pasta=tmp_path / "t", intervalo_s=0)
    glb_, info = executar(glb, CONFIG, t, nuvem)
    ds = nuvem.datasets[0]
    assert sorted(p.name for p in ds.iterdir()) == ["bake_blender.py", "config.json", "dataset-metadata.json", "modelo.glb"]
    assert json.loads((ds / "dataset-metadata.json").read_text()) == {"title": "imersa-bake-abc123", "id": "fulano/imersa-bake-abc123", "isPrivate": True, "licenses": [{"name": "other"}]}
    meta = json.loads((nuvem.kernels[0] / "kernel-metadata.json").read_text())
    assert meta["is_private"] and meta["enable_gpu"] and meta["enable_internet"]
    assert meta["dataset_sources"] == ["fulano/imersa-bake-abc123"] and meta["code_file"] == "bake.py"
    assert meta["id"] == "fulano/imersa-bakerender-abc123"
    assert glb_.exists() and info["dispositivo"] == "OPTIX" and info["largura"] == 8 and info["tempos_s"] == {"bake": 42.0}
    doc, _ = _ler_glb(glb_.read_bytes())
    assert doc["materials"][0]["occlusionTexture"] == {"index": doc["materials"][0]["occlusionTexture"]["index"], "texCoord": 1}


def test_erros_da_nuvem_e_saida_incompleta(tmp_path: Path):
    glb = tmp_path / "modelo.glb"
    glb.write_bytes(_glb_json_only({"asset": {"version": "2.0"}}))
    t = TrabalhoBake(id="abc123", usuario="u", pasta=tmp_path / "t", intervalo_s=0)
    with pytest.raises(ErroPipeline) as e:
        executar(glb, CONFIG, t, KaggleFalso({"etapa": "erro", "erro": "sem_gpu", "mensagem": "sem GPU"}))
    assert e.value.codigo == "sem_gpu"
    with pytest.raises(ErroPipeline, match="falhou"):
        executar(glb, CONFIG, t, KaggleFalso({}, status=["error"]))
    with pytest.raises(ErroPipeline, match="texturas"):
        executar(glb, CONFIG, t, KaggleFalso({"etapa": "pronto"}, completo=False))
    falso = tmp_path / "falso.glb"
    falso.write_bytes(b"nada")
    with pytest.raises(ErroPipeline) as e:
        executar(falso, CONFIG, t, KaggleFalso({"etapa": "pronto"}))
    assert e.value.codigo == "modelo_invalido"


def test_linha_de_comando(tmp_path: Path):
    glb = tmp_path / "modelo.glb"
    glb.write_bytes(_glb_json_only({"asset": {"version": "2.0"}}))
    r = tmp_path / "r.json"
    args = ["--glb", str(glb), "--id", "abc123", "--saida", str(tmp_path / "s"), "--resultado", str(r), "--usuario", "u", "--largura", "8"]
    assert principal(args, KaggleFalso({"etapa": "pronto", "dispositivo": "CPU"})) == 0
    assert json.loads(r.read_text())["ok"] is True
    with pytest.raises(SystemExit):
        principal([*args[:4], "Com Espaço", *args[5:]], KaggleFalso({}))


BLENDER = os.environ.get("IMERSA_BLENDER")


@pytest.mark.skipif(not BLENDER, reason="defina IMERSA_BLENDER com o executável do Blender 4.2 para o render real")
def test_bake_real_no_blender_gera_uv2_ao_e_as_duas_luzes(tmp_path: Path):
    """Cubo de verdade: confere que o Blender gera a UV2, as 3 texturas (com conteúdo, não lisas) e os extras."""
    import cv2

    glb = _cubo(tmp_path)
    r = tmp_path / "r.json"
    args = ["--glb", str(glb), "--id", "teste1", "--saida", str(tmp_path / "s"), "--resultado", str(r), "--blender", BLENDER, "--largura", "32", "--amostras", "8"]
    codigo = principal(args)
    info = json.loads(r.read_text())
    assert codigo == 0, info
    doc, binario = _ler_glb(Path(info["glb"]).read_bytes())
    m = doc["materials"][0]
    assert m["occlusionTexture"]["texCoord"] == 1
    assert "imersa_lightmap_dia" in m["extras"] and "imersa_lightmap_noite" in m["extras"]

    def imagem(indice_textura: int):
        tex = doc["textures"][indice_textura]
        img = doc["images"][tex["source"]]
        bv = doc["bufferViews"][img["bufferView"]]
        dados = binario[bv["byteOffset"] : bv["byteOffset"] + bv["byteLength"]]
        return cv2.imdecode(np.frombuffer(dados, np.uint8), cv2.IMREAD_UNCHANGED)

    ao = imagem(m["occlusionTexture"]["index"])
    dia = imagem(m["extras"]["imersa_lightmap_dia"])
    noite = imagem(m["extras"]["imersa_lightmap_noite"])
    assert ao.shape[:2] == (32, 32) and dia.shape[:2] == (32, 32) and noite.shape[:2] == (32, 32)
    # bake de verdade: não é uma textura lisa (tem variação de valores)
    assert ao.std() > 1 and dia.std() > 1
