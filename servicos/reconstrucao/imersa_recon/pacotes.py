"""
Pacotes do treino enviados UMA VEZ como dataset privado do Kaggle e instalados sem internet em cada captura:
mais rápido, não depende do PyPI no meio do trabalho e funciona mesmo se a internet do notebook falhar.
Versões fixas = o mesmo resultado sempre. Se o Kaggle trocar de Python, suba VERSAO e PYTHON_KAGGLE.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

#: Python das imagens atuais do Kaggle (visto no log do 1º teste real, 31/10/2026).
PYTHON_KAGGLE = "3.13"
VERSAO = "py313-v1"
RODAS = ["pycolmap==4.2.1", "gsplat==1.5.3", "jaxtyping==0.3.11", "wadler-lindig==0.1.8", "ninja==1.13.2"]
PLATAFORMAS = ["manylinux_2_28_x86_64", "manylinux2014_x86_64", "manylinux_2_17_x86_64"]
CACHE = Path(__file__).resolve().parent.parent / "trabalho" / f"_rodas-{VERSAO}"


def id_pacotes(usuario: str) -> str:
    return f"{usuario}/imersa-pacotes-{VERSAO}"


def baixar_rodas(destino: Path = CACHE) -> list[Path]:
    """Baixa (uma vez, com cache) as rodas Linux para o Python do Kaggle, sem dependências (torch e numpy já existem lá)."""
    destino.mkdir(parents=True, exist_ok=True)
    for pacote in RODAS:
        nome = pacote.split("==")[0].replace("-", "_").lower()
        if any(p.name.lower().startswith(f"{nome}-{pacote.split('==')[1]}") for p in destino.glob("*.whl")):
            continue
        plataformas = [x for p in PLATAFORMAS for x in ("--platform", p)]
        comando = [sys.executable, "-m", "pip", "download", pacote, "--no-deps", "--only-binary=:all:", "--python-version", PYTHON_KAGGLE, *plataformas, "-d", str(destino), "-q"]
        r = subprocess.run(comando, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"não foi possível baixar {pacote}: {r.stderr.strip()[-300:]}")
    return sorted(destino.glob("*.whl"))


def preparar_pacotes(usuario: str, pasta: Path) -> Path:
    if pasta.exists():
        shutil.rmtree(pasta)
    (pasta / "rodas").mkdir(parents=True)
    for roda in baixar_rodas():
        shutil.copy(roda, pasta / "rodas" / roda.name)
    (pasta / "dataset-metadata.json").write_text(
        json.dumps({"title": f"imersa-pacotes-{VERSAO}", "id": id_pacotes(usuario), "isPrivate": True, "licenses": [{"name": "other"}]})
    )
    return pasta
