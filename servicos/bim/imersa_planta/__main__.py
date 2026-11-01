"""Linha de comando do worker: python -m imersa_planta --entrada planta.pdf --imagem planta.png --resultado r.json

Grava a planta como PNG (o editor mostra essa imagem por baixo do desenho) e o JSON com paredes, aberturas e
cômodos detectados. Erro conhecido (formato, arquivo ruim) sai com código 2 e {"erro": "..."} no resultado.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2

from .detectar import detectar
from .entrada import PlantaInvalida, carregar


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="imersa_planta")
    p.add_argument("--entrada", required=True)
    p.add_argument("--imagem", required=True)
    p.add_argument("--resultado", required=True)
    a = p.parse_args(argv)
    try:
        cinza, escala = carregar(a.entrada)
        ok, png = cv2.imencode(".png", cinza)
        if not ok:
            raise PlantaInvalida("não foi possível gravar a imagem da planta")
        Path(a.imagem).write_bytes(png.tobytes())
        r = detectar(cinza, escala)
    except PlantaInvalida as e:
        Path(a.resultado).write_text(json.dumps({"erro": str(e)}, ensure_ascii=False), encoding="utf-8")
        return 2
    Path(a.resultado).write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
