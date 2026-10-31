"""
Uma reconstrução de ponta a ponta pela linha de comando.

  python -m imersa_recon.reconstruir --fotos PASTA --id sala-101
  python -m imersa_recon.reconstruir --video visita.mp4 --id sala-101
  python -m imersa_recon.reconstruir --zip fotos.zip --id sala-101 --resultado saida.json   (usado pelo worker)
  python -m imersa_recon.reconstruir --teste-playroom          (sala real do conjunto do 3DGS, com câmeras prontas)

Usuário do Kaggle: --usuario ou a variável KAGGLE_USERNAME. Login antes: `kaggle auth login`.
"""

import argparse
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path

from .entrada import ErroEntrada, extrair_zip
from .kaggle_cli import KaggleCli
from .pipeline import RAIZ, ErroPipeline, Nuvem, Trabalho, executar
from .video import extrair_quadros

ZIP_TESTE = RAIZ.parents[2] / "exemplos" / "fotos-para-reconstrucao" / "tandt_db.zip"


def preparar_playroom(destino: Path) -> tuple[Path, Path]:
    fotos, sparse = destino / "fotos", destino / "sparse"
    if not fotos.exists():
        with zipfile.ZipFile(ZIP_TESTE) as z:
            for nome in z.namelist():
                for prefixo, pasta in (("db/playroom/images/", fotos), ("db/playroom/sparse/0/", sparse)):
                    if nome.startswith(prefixo) and not nome.endswith("/"):
                        alvo = pasta / nome[len(prefixo) :]
                        alvo.parent.mkdir(parents=True, exist_ok=True)
                        alvo.write_bytes(z.read(nome))
    return fotos, sparse


def principal(argv: list[str] | None = None, nuvem: Nuvem | None = None) -> int:
    # o terminal do Windows usa cp1252 por padrão e não imprime acentos/setas da ajuda e das mensagens
    for fluxo in (sys.stdout, sys.stderr):
        if hasattr(fluxo, "reconfigure"):
            fluxo.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Fotos/vídeo → 3D na GPU gratuita do Kaggle")
    origem = p.add_mutually_exclusive_group(required=True)
    origem.add_argument("--fotos", type=Path)
    origem.add_argument("--video", type=Path)
    origem.add_argument("--zip", type=Path)
    origem.add_argument("--teste-playroom", action="store_true")
    p.add_argument("--id", default="playroom-teste")
    p.add_argument("--usuario", default=os.environ.get("KAGGLE_USERNAME"))
    p.add_argument("--iteracoes", type=int, default=7000)
    p.add_argument("--trabalho", type=Path, default=RAIZ / "trabalho")
    p.add_argument("--resultado", type=Path, help="grava o resultado (JSON) também neste arquivo")
    a = p.parse_args(argv)
    if not a.usuario:
        p.error("informe --usuario (o nome de usuário do Kaggle) ou KAGGLE_USERNAME")

    def responder(dados: dict, codigo: int) -> int:
        texto = json.dumps(dados, ensure_ascii=False, indent=2)
        print(texto)
        if a.resultado:
            a.resultado.parent.mkdir(parents=True, exist_ok=True)
            a.resultado.write_text(texto, encoding="utf-8")
        return codigo

    pasta = a.trabalho / a.id
    sparse = None
    try:
        if a.teste_playroom:
            fotos, sparse = preparar_playroom(a.trabalho / "_playroom")
        elif a.video or a.zip:
            fotos = pasta / "entrada"
            if fotos.exists():
                shutil.rmtree(fotos)
            if a.video:
                extrair_quadros(a.video, fotos)
            else:
                extrair_zip(a.zip, fotos)
        else:
            fotos = a.fotos
    except (ErroEntrada, ValueError) as e:
        return responder({"ok": False, "erro": "entrada_invalida", "mensagem": str(e), "detalhes": []}, 2)
    t = Trabalho(id=a.id, usuario=a.usuario, pasta=pasta, sparse=sparse)
    t.config["iteracoes"] = a.iteracoes
    if nuvem is None:
        nuvem = KaggleCli(shutil.which("kaggle") or str(Path(sys.executable).parent / "kaggle"))
    try:
        r = executar(fotos, t, nuvem)
    except ErroPipeline as e:
        return responder({"ok": False, "erro": e.codigo, "mensagem": str(e), "detalhes": e.detalhes}, 2)
    return responder(
        {
            "ok": True,
            "splat": str(r.splat),
            "mb": round(r.splat.stat().st_size / 2**20, 2),
            "rostos_desfocados": r.rostos_desfocados,
            "avisos": r.avisos,
            "metricas": r.metricas,
        },
        0,
    )


if __name__ == "__main__":
    sys.exit(principal())
