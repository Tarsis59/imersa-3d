"""PLY → formato leve para a web, com splat-transform (PlayCanvas, MIT). Requer Node.js (npx)."""

import shutil
import subprocess
from pathlib import Path

VERSAO_SPLAT_TRANSFORM = "3.10.3"
FORMATOS = {".sog", ".spz", ".ply"}


def comprimir(entrada: Path, saida: Path, filtros: list[str] | None = None) -> Path:
    """
    Converte (o formato sai da extensão de `saida`: .sog é o menor; .spz é o da Niantic). `filtros` são ações
    do splat-transform (ex.: ["-N"] tira valores inválidos). Versão fixa: o mesmo arquivo sempre gera o mesmo resultado.
    """
    if saida.suffix.lower() not in FORMATOS:
        raise ValueError(f"formato de saída não suportado: {saida.suffix}")
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("Node.js (npx) não encontrado: instale o Node para comprimir os splats")
    saida.parent.mkdir(parents=True, exist_ok=True)
    comando = [npx, "-y", f"@playcanvas/splat-transform@{VERSAO_SPLAT_TRANSFORM}", "-w", str(entrada), *(filtros or ["-N"]), str(saida)]
    r = subprocess.run(comando, capture_output=True, text=True, timeout=1800)
    if r.returncode != 0 or not saida.exists():
        raise RuntimeError(f"splat-transform falhou: {(r.stderr or r.stdout).strip()[-500:]}")
    return saida
