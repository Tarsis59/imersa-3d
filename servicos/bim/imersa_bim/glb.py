"""Ler e regravar o JSON de um GLB sem tocar no binário (para anotar os nós com o tipo IFC)."""

import json
import struct
from pathlib import Path

JSON, BIN = 0x4E4F534A, 0x004E4942


def ler_glb(caminho: Path) -> tuple[dict, bytes]:
    dados = Path(caminho).read_bytes()
    if dados[:4] != b"glTF":
        raise ValueError("não é um GLB")
    pos, doc, binario = 12, None, b""
    while pos < len(dados):
        tamanho, tipo = struct.unpack_from("<II", dados, pos)
        trecho = dados[pos + 8 : pos + 8 + tamanho]
        if tipo == JSON:
            doc = json.loads(trecho)
        elif tipo == BIN:
            binario = trecho
        pos += 8 + tamanho
    if doc is None:
        raise ValueError("GLB sem JSON")
    return doc, binario


def gravar_glb(caminho: Path, doc: dict, binario: bytes) -> None:
    js = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)  # trechos alinhados em 4 bytes (JSON com espaços, binário com zeros)
    binario += b"\0" * (-len(binario) % 4)
    trechos = struct.pack("<II", len(js), JSON) + js + (struct.pack("<II", len(binario), BIN) + binario if binario else b"")
    Path(caminho).write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + len(trechos)) + trechos)
