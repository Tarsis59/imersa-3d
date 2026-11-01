"""
Giro 360° fotorrealista de um prédio: GLB (sem compressão) + nós das unidades → Blender Cycles na GPU gratuita do
Kaggle → giro.zip (72 quadros JPEG + 72 máscaras PNG + giro.json).

  python -m imersa_recon.giro --glb modelo.glb --nos nos.json --id 3f2a9c1e --saida pasta --resultado r.json
  python -m imersa_recon.giro ... --blender C:/blender/blender.exe      (roda no Blender local, sem Kaggle)

Usuário do Kaggle: --usuario ou a variável KAGGLE_USERNAME. Login antes: `kaggle auth login`.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .kaggle_cli import KaggleCli
from .pipeline import RAIZ, ErroPipeline, Nuvem

PADRAO = {"quadros": 72, "largura": 1280, "altura": 720, "amostras": 96}
#: o ZIP vai para o navegador (celular): acima disso o giro fica pesado demais para abrir
MAX_ZIP_MB = 80


@dataclass
class TrabalhoGiro:
    id: str
    usuario: str
    pasta: Path
    intervalo_s: float = 30
    #: a sessão gratuita de GPU dura até 12 h; um giro normal leva minutos
    limite_s: float = 3 * 3600

    @property
    def id_dataset(self) -> str:
        return f"{self.usuario}/imersa-giro-{self.id}"

    @property
    def id_kernel(self) -> str:
        # nome diferente do dataset: o Kaggle recusa (409) notebook com o mesmo nome de um dataset da conta
        return f"{self.usuario}/imersa-render-{self.id}"


def preparar_dataset(glb: Path, nos: list[str], config: dict, t: TrabalhoGiro) -> Path:
    destino = t.pasta / "dataset"
    if destino.exists():
        shutil.rmtree(destino)
    destino.mkdir(parents=True)
    shutil.copy(glb, destino / "modelo.glb")
    (destino / "nos.json").write_text(json.dumps(nos))
    (destino / "config.json").write_text(json.dumps(config))
    shutil.copy(RAIZ / "kaggle" / "giro_blender.py", destino / "giro_blender.py")
    (destino / "dataset-metadata.json").write_text(
        json.dumps({"title": f"imersa-giro-{t.id}", "id": t.id_dataset, "isPrivate": True, "licenses": [{"name": "other"}]})
    )
    return destino


def preparar_kernel(t: TrabalhoGiro) -> Path:
    destino = t.pasta / "kernel"
    destino.mkdir(parents=True, exist_ok=True)
    shutil.copy(RAIZ / "kaggle" / "giro.py", destino / "giro.py")
    meta = {
        "id": t.id_kernel,
        "title": f"imersa-render-{t.id}",
        "code_file": "giro.py",
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


def _esperar(nuvem: Nuvem, t: TrabalhoGiro) -> None:
    inicio = time.monotonic()
    while not nuvem.dataset_pronto(t.id_dataset):
        if time.monotonic() - inicio > t.limite_s:
            raise ErroPipeline("tempo_esgotado", "O envio do modelo para a nuvem não terminou a tempo.")
        time.sleep(t.intervalo_s)
    nuvem.enviar_kernel(preparar_kernel(t))
    while True:
        estado = nuvem.status(t.id_kernel).lower()
        if "complete" in estado:
            return
        if any(x in estado for x in ("error", "cancel")):
            raise ErroPipeline("falha_na_gpu", f"O render na nuvem falhou ({estado}). Tente de novo mais tarde.")
        if time.monotonic() - inicio >= t.limite_s:
            raise ErroPipeline("tempo_esgotado", "O render na nuvem passou do tempo limite.")
        time.sleep(t.intervalo_s)


def conferir_zip(zip_: Path, quadros: int) -> dict:
    """O ZIP tem de ter giro.json e cada quadro com a sua máscara (o navegador confia nisso)."""
    try:
        with zipfile.ZipFile(zip_) as z:
            nomes = set(z.namelist())
            giro = json.loads(z.read("giro.json"))
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as e:
        raise ErroPipeline("falha_na_gpu", "A nuvem devolveu um giro incompleto.") from e
    faltando = [f"{q:03d}" for q in range(quadros) if f"cor_{q:03d}.jpg" not in nomes or f"mascara_{q:03d}.png" not in nomes]
    if giro.get("quadros") != quadros or faltando:
        raise ErroPipeline("falha_na_gpu", "A nuvem devolveu um giro incompleto.", faltando[:10])
    mb = zip_.stat().st_size / 2**20
    if mb > MAX_ZIP_MB:
        raise ErroPipeline("giro_grande_demais", f"O giro ficou com {mb:.0f} MB (máximo {MAX_ZIP_MB}). Use menos quadros ou uma resolução menor.")
    return {**giro, "mb": round(mb, 2)}


def executar(glb: Path, nos: list[str], config: dict, t: TrabalhoGiro, nuvem: Nuvem) -> tuple[Path, dict]:
    if glb.read_bytes()[:4] != b"glTF":
        raise ErroPipeline("modelo_invalido", "O modelo do prédio não é um GLB.")
    t.pasta.mkdir(parents=True, exist_ok=True)
    nuvem.criar_dataset(preparar_dataset(glb, nos, config, t))
    _esperar(nuvem, t)
    saida = t.pasta / "saida"
    nuvem.baixar_saida(t.id_kernel, saida)
    arquivo = saida / "resultado.json"
    if not arquivo.exists():
        raise ErroPipeline("falha_na_gpu", "A nuvem terminou sem devolver o resultado.")
    resultado = json.loads(arquivo.read_text(encoding="utf-8"))
    if resultado.get("etapa") != "pronto":
        raise ErroPipeline(resultado.get("erro", "falha_na_gpu"), resultado.get("mensagem", "O render na nuvem não terminou."))
    zip_ = saida / "giro.zip"
    if not zip_.exists():
        raise ErroPipeline("falha_na_gpu", "A nuvem terminou sem o giro.")
    return zip_, {**conferir_zip(zip_, config["quadros"]), "tempos_s": resultado.get("tempos_s", {})}


def executar_local(glb: Path, nos: list[str], config: dict, pasta: Path, blender: str) -> tuple[Path, dict]:
    """Mesmo render no Blender desta máquina (sem Kaggle): testes e quem tem placa de vídeo própria."""
    quadros = pasta / "quadros"
    shutil.rmtree(quadros, ignore_errors=True)
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / "nos.json").write_text(json.dumps(nos))
    comando = [
        blender, "-b", "--factory-startup", "-noaudio", "-P", str(RAIZ / "kaggle" / "giro_blender.py"), "--",
        "--glb", str(glb), "--unidades", str(pasta / "nos.json"), "--saida", str(quadros),
        "--quadros", str(config["quadros"]), "--largura", str(config["largura"]), "--altura", str(config["altura"]),
        "--amostras", str(config["amostras"]), "--gpu",
    ]  # fmt: skip
    inicio = time.monotonic()
    r = subprocess.run(comando, capture_output=True, text=True)
    if r.returncode != 0 or not (quadros / "giro.json").exists():
        raise ErroPipeline("falha_no_render", "O Blender não terminou o giro.", (r.stderr or r.stdout or "").strip().splitlines()[-5:])
    zip_ = pasta / "giro.zip"
    with zipfile.ZipFile(zip_, "w") as z:
        for arquivo in sorted(quadros.iterdir()):
            z.write(arquivo, arquivo.name, compress_type=zipfile.ZIP_DEFLATED if arquivo.suffix == ".json" else zipfile.ZIP_STORED)
    return zip_, {**conferir_zip(zip_, config["quadros"]), "tempos_s": {"render": round(time.monotonic() - inicio, 1)}}


def principal(argv: list[str] | None = None, nuvem: Nuvem | None = None) -> int:
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Giro 360° fotorrealista (Blender Cycles) na GPU gratuita do Kaggle")
    p.add_argument("--glb", type=Path, required=True)
    p.add_argument("--nos", type=Path, required=True, help="JSON: nós das unidades, na ordem dos índices")
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
        nos = json.loads(a.nos.read_text(encoding="utf-8"))
        if not isinstance(nos, list) or not all(isinstance(n, str) for n in nos):
            raise ValueError
        if a.blender:
            zip_, info = executar_local(a.glb, nos, config, a.saida, a.blender)
        else:
            if nuvem is None:
                nuvem = KaggleCli(shutil.which("kaggle") or str(Path(sys.executable).parent / "kaggle"))
            zip_, info = executar(a.glb, nos, config, TrabalhoGiro(id=a.id, usuario=a.usuario, pasta=a.saida), nuvem)
    except (ValueError, OSError) as e:
        return responder({"ok": False, "erro": "entrada_invalida", "mensagem": f"Entrada inválida: {e}", "detalhes": []}, 2)
    except ErroPipeline as e:
        return responder({"ok": False, "erro": e.codigo, "mensagem": str(e), "detalhes": e.detalhes}, 2)
    except RuntimeError as e:  # cliente do Kaggle recusou/caiu: transitório (o worker tenta de novo)
        return responder({"ok": False, "erro": "falha_na_gpu", "mensagem": str(e)[:500], "detalhes": []}, 2)
    return responder({"ok": True, "zip": str(zip_), **info}, 0)


if __name__ == "__main__":
    sys.exit(principal())
