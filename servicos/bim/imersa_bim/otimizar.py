"""GLB → GLB comprimido (Meshopt) com gltf-transform (MIT). Requer Node.js (npx). Não junta nem renomeia peças."""

import shutil
import subprocess
from pathlib import Path

VERSAO_GLTF_TRANSFORM = "4.5.1"


def otimizar(entrada: Path, saida: Path) -> Path:
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("Node.js (npx) não encontrado: instale o Node para otimizar o 3D")
    saida = Path(saida)
    saida.parent.mkdir(parents=True, exist_ok=True)
    # "meshopt" só comprime a geometria; "optimize" juntaria peças e apagaria os nomes (o vínculo com as unidades)
    comando = [npx, "-y", f"@gltf-transform/cli@{VERSAO_GLTF_TRANSFORM}", "meshopt", str(entrada), str(saida), "--level", "high"]
    r = subprocess.run(comando, capture_output=True, text=True, timeout=1800)
    if r.returncode != 0 or not saida.exists():
        raise RuntimeError(f"gltf-transform falhou: {(r.stderr or r.stdout).strip()[-500:]}")
    return saida
