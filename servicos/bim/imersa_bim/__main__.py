"""
Linha de comando do worker: python -m imersa_bim --ifc projeto.ifc --glb modelo.glb --resultado resultado.json
Saída 0 = ok; 1 = arquivo recusado (não adianta tentar de novo); 2 = falha da máquina (tentar de novo).
"""

import argparse
import json
import sys
import tempfile
from pathlib import Path

from .converter import converter
from .otimizar import otimizar


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="imersa_bim")
    p.add_argument("--ifc", required=True, type=Path)
    p.add_argument("--glb", required=True, type=Path)
    p.add_argument("--resultado", required=True, type=Path)
    a = p.parse_args(argv)

    def responder(dados: dict, codigo: int) -> int:
        a.resultado.parent.mkdir(parents=True, exist_ok=True)
        a.resultado.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
        return codigo

    with tempfile.TemporaryDirectory() as pasta:
        bruto = Path(pasta) / "bruto.glb"
        try:
            r = converter(a.ifc, bruto)
        except ValueError as e:
            sem_geometria = "geometria" in str(e)
            return responder(
                {
                    "ok": False,
                    "erro": "sem_geometria" if sem_geometria else "ifc_invalido",
                    "mensagem": "O IFC não tem geometria para mostrar em 3D." if sem_geometria else "O arquivo não é um IFC válido.",
                },
                1,
            )
        try:
            otimizar(bruto, a.glb)
        except RuntimeError as e:
            return responder({"ok": False, "erro": "falha_otimizacao", "mensagem": str(e)[:500]}, 2)
    return responder({"ok": True, "elementos": r["elementos"], "bytesOriginal": r["bytes"], "bytes": a.glb.stat().st_size, "metadados": r["metadados"]}, 0)


if __name__ == "__main__":
    sys.exit(main())
