"""
Luz pré-calculada do prédio (Plano 12a, item 6): GLB do modelo → Blender Cycles na GPU gratuita do Kaggle → GLB
"assado" (occlusionTexture padrão do glTF, canal UV2, + extras com as texturas de luz de dia e de noite).

  python -m imersa_recon.bake --glb modelo.glb --id 3f2a9c1e --saida pasta --resultado r.json
  python -m imersa_recon.bake ... --blender C:/blender/blender.exe      (roda no Blender local, sem Kaggle)

Usuário do Kaggle: --usuario ou a variável KAGGLE_USERNAME. Login antes: `kaggle auth login`.

Por que extras (e não uma extensão glTF): o glTF core só tem um slot padrão para oclusão (`occlusionTexture`),
que o three.js já lê como `aoMap` (canal UV2, sem código nenhum no viewer). Luz difusa pré-calculada (lightmap)
não tem slot padrão no glTF — não existe uma extensão `KHR_materials_lightmap` estável — então as duas texturas
(dia e noite) entram como `extras` do material (`imersa_lightmap_dia`/`imersa_lightmap_noite`, o índice de cada
textura no array `textures`), que o `GLTFLoader` do three.js copia para `material.userData` sem precisar de
nenhum carregador customizado; o viewer (`packages/viewer/src/bake/lightmap.ts`) lê esses dois índices e mistura
as texturas no shader pela hora do dia.
"""

import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from .kaggle_cli import KaggleCli
from .pipeline import RAIZ, ErroPipeline, Nuvem

PADRAO = {"largura": 1024, "amostras": 64}  # poucas amostras + denoise do compositor (ver kaggle/bake_blender.py)
#: o GLB assado vai para o navegador (celular): acima disso fica pesado demais para abrir
MAX_GLB_MB = 80
_JSON, _BIN = 0x4E4F534A, 0x004E4942


@dataclass
class TrabalhoBake:
    id: str
    usuario: str
    pasta: Path
    intervalo_s: float = 30
    #: a sessão gratuita de GPU dura até 12 h; um bake normal leva minutos
    limite_s: float = 3 * 3600

    @property
    def id_dataset(self) -> str:
        return f"{self.usuario}/imersa-bake-{self.id}"

    @property
    def id_kernel(self) -> str:
        return f"{self.usuario}/imersa-bakerender-{self.id}"


def preparar_dataset(glb: Path, config: dict, t: TrabalhoBake) -> Path:
    destino = t.pasta / "dataset"
    if destino.exists():
        shutil.rmtree(destino)
    destino.mkdir(parents=True)
    shutil.copy(glb, destino / "modelo.glb")
    (destino / "config.json").write_text(json.dumps(config))
    shutil.copy(RAIZ / "kaggle" / "bake_blender.py", destino / "bake_blender.py")
    (destino / "dataset-metadata.json").write_text(
        json.dumps({"title": f"imersa-bake-{t.id}", "id": t.id_dataset, "isPrivate": True, "licenses": [{"name": "other"}]})
    )
    return destino


def preparar_kernel(t: TrabalhoBake) -> Path:
    destino = t.pasta / "kernel"
    destino.mkdir(parents=True, exist_ok=True)
    shutil.copy(RAIZ / "kaggle" / "bake.py", destino / "bake.py")
    meta = {
        "id": t.id_kernel,
        "title": f"imersa-bakerender-{t.id}",
        "code_file": "bake.py",
        "language": "python",
        "kernel_type": "script",
        "is_private": True,
        "enable_gpu": True,
        "enable_tpu": False,
        "enable_internet": True,  # baixa o Blender
        "dataset_sources": [t.id_dataset],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }
    (destino / "kernel-metadata.json").write_text(json.dumps(meta, indent=2))
    return destino


def _esperar(nuvem: Nuvem, t, preparar=None) -> None:
    inicio = time.monotonic()
    while not nuvem.dataset_pronto(t.id_dataset):
        if time.monotonic() - inicio > t.limite_s:
            raise ErroPipeline("tempo_esgotado", "O envio do modelo para a nuvem não terminou a tempo.")
        time.sleep(t.intervalo_s)
    nuvem.enviar_kernel((preparar or preparar_kernel)(t))
    falhas = 0
    while True:
        try:
            estado = nuvem.status(t.id_kernel).lower()
            falhas = 0
        except RuntimeError:
            falhas += 1
            if falhas > 10:
                raise
            time.sleep(t.intervalo_s)
            continue
        if "complete" in estado:
            return
        if any(x in estado for x in ("error", "cancel")):
            raise ErroPipeline("falha_na_gpu", f"O bake na nuvem falhou ({estado}). Tente de novo mais tarde.")
        if time.monotonic() - inicio >= t.limite_s:
            raise ErroPipeline("tempo_esgotado", "O bake na nuvem passou do tempo limite.")
        time.sleep(t.intervalo_s)


def _ler_glb(dados: bytes) -> tuple[dict, bytes]:
    if dados[:4] != b"glTF":
        raise ErroPipeline("modelo_invalido", "O arquivo não é um GLB.")
    pos = 12
    doc: dict | None = None
    binario = b""
    while pos + 8 <= len(dados):
        tam_chunk, tipo = struct.unpack_from("<II", dados, pos)
        corpo = dados[pos + 8 : pos + 8 + tam_chunk]
        if tipo == _JSON:
            doc = json.loads(corpo)
        elif tipo == _BIN:
            binario = corpo
        pos += 8 + tam_chunk
    if doc is None:
        raise ErroPipeline("falha_na_gpu", "A nuvem devolveu um GLB sem o bloco JSON.")
    return doc, binario


def _escrever_glb(doc: dict, binario: bytes) -> bytes:
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    corpo = struct.pack("<II", len(js), _JSON) + js
    if binario:
        pad = binario + b"\0" * (-len(binario) % 4)
        corpo += struct.pack("<II", len(pad), _BIN) + pad
    return b"glTF" + struct.pack("<II", 2, 12 + len(corpo)) + corpo


def anexar_lightmaps_no_glb(glb: bytes, ao_png: bytes, dia_png: bytes, noite_png: bytes) -> bytes:
    """
    GLB "cru" exportado pelo Blender (já com UV2 do lightmap pack) + as 3 texturas assadas → GLB "assado": AO no
    `occlusionTexture` padrão (canal UV2) e as duas texturas de luz nos extras do material (ver módulo). Função
    pura (sem Blender): dá para testar sem GPU nenhuma.
    """
    doc, binario = _ler_glb(glb)
    if not doc.get("materials"):
        raise ErroPipeline("modelo_invalido", "O modelo não tem nenhum material para assar a luz.")
    buffers = doc.setdefault("buffers", [])
    if not buffers:
        buffers.append({"byteLength": 0})
    buffer_views = doc.setdefault("bufferViews", [])
    images = doc.setdefault("images", [])
    textures = doc.setdefault("textures", [])
    samplers = doc.setdefault("samplers", [])
    if not samplers:
        samplers.append({})

    def anexar_imagem(png: bytes) -> int:
        nonlocal binario
        binario += b"\0" * (-len(binario) % 4)
        offset = len(binario)
        binario += png
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(png)})
        images.append({"bufferView": len(buffer_views) - 1, "mimeType": "image/png"})
        textures.append({"source": len(images) - 1, "sampler": 0})
        return len(textures) - 1

    idx_ao = anexar_imagem(ao_png)
    idx_dia = anexar_imagem(dia_png)
    idx_noite = anexar_imagem(noite_png)
    buffers[0]["byteLength"] = len(binario)

    for m in doc["materials"]:
        m["occlusionTexture"] = {"index": idx_ao, "texCoord": 1}
        extras = m.get("extras") if isinstance(m.get("extras"), dict) else {}
        m["extras"] = {**extras, "imersa_lightmap_dia": idx_dia, "imersa_lightmap_noite": idx_noite}

    return _escrever_glb(doc, binario)


def conferir_glb(glb: Path) -> dict:
    dados = glb.read_bytes()
    if dados[:4] != b"glTF":
        raise ErroPipeline("falha_na_gpu", "A nuvem devolveu um bake inválido.")
    mb = len(dados) / 2**20
    if mb > MAX_GLB_MB:
        raise ErroPipeline("bake_grande_demais", f"O bake ficou com {mb:.0f} MB (máximo {MAX_GLB_MB}). Use uma textura menor.")
    return {"mb": round(mb, 2)}


def _compor(saida: Path) -> tuple[Path, dict]:
    """baseline.glb + ao/dia/noite.png (saídos do Blender, local ou Kaggle) → modelo assado final."""
    base = saida / "baseline.glb"
    if not base.exists():
        raise ErroPipeline("falha_na_gpu", "A nuvem terminou sem o modelo com o UV2 do lightmap.")
    faltando = [n for n in ("ao.png", "dia.png", "noite.png") if not (saida / n).exists()]
    if faltando:
        raise ErroPipeline("falha_na_gpu", "A nuvem terminou sem todas as texturas do bake.", faltando)
    assado = anexar_lightmaps_no_glb(base.read_bytes(), (saida / "ao.png").read_bytes(), (saida / "dia.png").read_bytes(), (saida / "noite.png").read_bytes())
    destino = saida.parent / "assado.glb"
    destino.write_bytes(assado)
    return destino, conferir_glb(destino)


def executar(glb: Path, config: dict, t: TrabalhoBake, nuvem: Nuvem) -> tuple[Path, dict]:
    if glb.read_bytes()[:4] != b"glTF":
        raise ErroPipeline("modelo_invalido", "O modelo do prédio não é um GLB.")
    t.pasta.mkdir(parents=True, exist_ok=True)
    nuvem.criar_dataset(preparar_dataset(glb, config, t))
    _esperar(nuvem, t)
    saida = t.pasta / "saida"
    nuvem.baixar_saida(t.id_kernel, saida)
    arquivo = saida / "resultado.json"
    if not arquivo.exists():
        raise ErroPipeline("falha_na_gpu", "A nuvem terminou sem devolver o resultado.")
    resultado = json.loads(arquivo.read_text(encoding="utf-8"))
    if resultado.get("etapa") != "pronto":
        raise ErroPipeline(resultado.get("erro", "falha_na_gpu"), resultado.get("mensagem", "O bake na nuvem não terminou."))
    destino, info = _compor(saida)
    return destino, {**info, "dispositivo": resultado.get("dispositivo", "?"), "largura": config["largura"], "tempos_s": resultado.get("tempos_s", {})}


def executar_local(glb: Path, config: dict, pasta: Path, blender: str) -> tuple[Path, dict]:
    """Mesmo bake no Blender desta máquina (sem Kaggle): testes e quem tem placa de vídeo própria."""
    saida = pasta / "saida"
    shutil.rmtree(saida, ignore_errors=True)
    pasta.mkdir(parents=True, exist_ok=True)
    comando = [
        blender, "-b", "--factory-startup", "-noaudio", "-P", str(RAIZ / "kaggle" / "bake_blender.py"), "--",
        "--glb", str(glb), "--saida", str(saida), "--largura", str(config["largura"]), "--amostras", str(config["amostras"]), "--gpu",
    ]  # fmt: skip
    inicio = time.monotonic()
    r = subprocess.run(comando, capture_output=True, text=True)
    if r.returncode != 0 or not (saida / "baseline.glb").exists():
        raise ErroPipeline("falha_no_render", "O Blender não terminou o bake.", (r.stderr or r.stdout or "").strip().splitlines()[-5:])
    destino, info = _compor(saida)
    return destino, {**info, "dispositivo": "CPU", "largura": config["largura"], "tempos_s": {"bake": round(time.monotonic() - inicio, 1)}}


def principal(argv: list[str] | None = None, nuvem: Nuvem | None = None) -> int:
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Luz pré-calculada (AO + dia/noite, Blender Cycles) na GPU gratuita do Kaggle")
    p.add_argument("--glb", type=Path, required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--saida", type=Path, required=True)
    p.add_argument("--resultado", type=Path)
    p.add_argument("--usuario", default=os.environ.get("KAGGLE_USERNAME"))
    p.add_argument("--blender", help="executável do Blender local (sem Kaggle)")
    for chave, valor in PADRAO.items():
        p.add_argument(f"--{chave}", type=int, default=valor)
    a = p.parse_args(argv)
    if not re.fullmatch(r"[a-z0-9-]{4,40}", a.id):
        p.error("--id: só letras minúsculas, números e hífen (4 a 40)")
    if not a.blender and not a.usuario:
        p.error("informe --usuario (o nome de usuário do Kaggle) ou KAGGLE_USERNAME")

    def responder(dados: dict, codigo: int) -> int:
        texto = json.dumps(dados, ensure_ascii=False, indent=2)
        print(texto)
        if a.resultado:
            a.resultado.parent.mkdir(parents=True, exist_ok=True)
            a.resultado.write_text(texto, encoding="utf-8")
        return codigo

    config = {k: getattr(a, k) for k in PADRAO}
    try:
        if a.blender:
            glb_, info = executar_local(a.glb, config, a.saida, a.blender)
        else:
            if nuvem is None:
                nuvem = KaggleCli(shutil.which("kaggle") or str(Path(sys.executable).parent / "kaggle"))
            glb_, info = executar(a.glb, config, TrabalhoBake(id=a.id, usuario=a.usuario, pasta=a.saida), nuvem)
    except (ValueError, OSError) as e:
        return responder({"ok": False, "erro": "entrada_invalida", "mensagem": f"Entrada inválida: {e}", "detalhes": []}, 2)
    except ErroPipeline as e:
        return responder({"ok": False, "erro": e.codigo, "mensagem": str(e), "detalhes": e.detalhes}, 2)
    except RuntimeError as e:  # cliente do Kaggle recusou/caiu: transitório (o worker tenta de novo)
        return responder({"ok": False, "erro": "falha_na_gpu", "mensagem": str(e)[:500], "detalhes": []}, 2)
    return responder({"ok": True, "glb": str(glb_), **info}, 0)


if __name__ == "__main__":
    sys.exit(principal())
