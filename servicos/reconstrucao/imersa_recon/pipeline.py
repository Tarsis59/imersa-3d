"""
Orquestra uma captura: valida → desfoca rostos → envia (privado) para a GPU gratuita do Kaggle → acompanha →
baixa → comprime para a web. O acesso ao Kaggle fica atrás de `Nuvem`, para os testes usarem um falso.
"""

import json
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import cv2

from .compressao import comprimir
from .pacotes import id_pacotes, preparar_pacotes
from .rostos import EXTENSOES, processar_pasta
from .validador import avaliar

RAIZ = Path(__file__).resolve().parent.parent
CONFIG_PADRAO = {"iteracoes": 7000, "lado_maximo": 1600, "grau_sh": 3}


class Nuvem(Protocol):
    def criar_dataset(self, pasta: Path) -> None: ...
    def dataset_pronto(self, id_dataset: str) -> bool: ...
    def dataset_existe(self, id_dataset: str) -> bool: ...
    def enviar_kernel(self, pasta: Path) -> None: ...
    def status(self, id_kernel: str) -> str: ...
    def baixar_saida(self, id_kernel: str, destino: Path) -> None: ...


@dataclass
class Trabalho:
    id: str
    usuario: str
    pasta: Path
    config: dict = field(default_factory=lambda: dict(CONFIG_PADRAO))
    #: entre consultas de status (o Kaggle não gosta de consultas seguidas)
    intervalo_s: float = 30
    #: o Kaggle encerra sessões de GPU em 12 h; aqui desistimos antes
    limite_s: float = 4 * 3600
    #: câmeras já calculadas pelo COLMAP (pasta com cameras.bin etc.): a nuvem pula essa etapa
    sparse: Path | None = None

    @property
    def id_dataset(self) -> str:
        return f"{self.usuario}/imersa-{self.id}"

    @property
    def id_kernel(self) -> str:
        return f"{self.usuario}/imersa-treino-{self.id}"


@dataclass
class Resultado:
    splat: Path | None
    metricas: dict
    rostos_desfocados: int
    avisos: list[str]


class ErroPipeline(Exception):
    def __init__(self, codigo: str, mensagem: str, detalhes: list[str] | None = None):
        super().__init__(mensagem)
        self.codigo = codigo
        self.detalhes = detalhes or []


def _fotos(pasta: Path) -> list[Path]:
    return sorted(p for p in pasta.iterdir() if p.suffix.lower() in EXTENSOES)


def preparar_dataset(fotos: Path, t: Trabalho) -> tuple[Path, int]:
    destino = t.pasta / "dataset"
    if destino.exists():
        shutil.rmtree(destino)
    contagem = processar_pasta(fotos, destino / "fotos")  # LGPD: só fotos já desfocadas saem do servidor
    shutil.copytree(RAIZ / "imersa_recon", destino / "codigo" / "imersa_recon", ignore=shutil.ignore_patterns("__pycache__"))
    if t.sparse:
        shutil.copytree(t.sparse, destino / "sparse" / "0")
    (destino / "config.json").write_text(json.dumps(t.config))
    (destino / "dataset-metadata.json").write_text(
        json.dumps({"title": f"imersa-{t.id}", "id": t.id_dataset, "isPrivate": True, "licenses": [{"name": "other"}]})
    )
    return destino, sum(contagem.values())


def preparar_kernel(t: Trabalho) -> Path:
    destino = t.pasta / "kernel"
    destino.mkdir(parents=True, exist_ok=True)
    shutil.copy(RAIZ / "kaggle" / "treinar.py", destino / "treinar.py")
    meta = {
        "id": t.id_kernel,
        "title": f"imersa-treino-{t.id}",
        "code_file": "treinar.py",
        "language": "python",
        "kernel_type": "script",
        "is_private": True,
        "enable_gpu": True,
        "enable_tpu": False,
        "enable_internet": True,  # instala gsplat e pycolmap
        "dataset_sources": [t.id_dataset, id_pacotes(t.usuario)],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }
    (destino / "kernel-metadata.json").write_text(json.dumps(meta, indent=2))
    return destino


def _garantir_pacotes(nuvem: Nuvem, t: Trabalho) -> None:
    """Pacotes do treino (pycolmap, gsplat...) num dataset reaproveitável: enviado só na 1ª captura."""
    if not nuvem.dataset_existe(id_pacotes(t.usuario)):
        nuvem.criar_dataset(preparar_pacotes(t.usuario, t.pasta.parent / "_pacotes"))


def _esperar(nuvem: Nuvem, t: Trabalho) -> None:
    inicio = time.monotonic()
    while not (nuvem.dataset_pronto(t.id_dataset) and nuvem.dataset_pronto(id_pacotes(t.usuario))):
        if time.monotonic() - inicio > t.limite_s:
            raise ErroPipeline("tempo_esgotado", "O envio das fotos para a nuvem não terminou a tempo.")
        time.sleep(t.intervalo_s)
    nuvem.enviar_kernel(preparar_kernel(t))
    while True:
        estado = nuvem.status(t.id_kernel).lower()
        if "complete" in estado:
            return
        if any(x in estado for x in ("error", "cancel")):
            raise ErroPipeline("falha_na_gpu", f"O processamento na nuvem falhou ({estado}). Tente de novo mais tarde.")
        if time.monotonic() - inicio >= t.limite_s:
            raise ErroPipeline("tempo_esgotado", "O processamento na nuvem passou do tempo limite.")
        time.sleep(t.intervalo_s)


def executar(fotos: Path, t: Trabalho, nuvem: Nuvem) -> Resultado:
    caminhos = _fotos(fotos)
    imagens = [cv2.imread(str(p)) for p in caminhos]
    if any(i is None for i in imagens):
        raise ErroPipeline("foto_ilegivel", "Uma das fotos não pôde ser lida.", [p.name for p, i in zip(caminhos, imagens) if i is None])
    relatorio = avaliar(imagens)
    del imagens
    if not relatorio.aprovado:
        raise ErroPipeline("fotos_reprovadas", "As fotos não passaram na verificação de qualidade.", relatorio.problemas)

    t.pasta.mkdir(parents=True, exist_ok=True)
    _garantir_pacotes(nuvem, t)
    dataset, rostos = preparar_dataset(fotos, t)
    nuvem.criar_dataset(dataset)
    _esperar(nuvem, t)

    saida = t.pasta / "saida"
    nuvem.baixar_saida(t.id_kernel, saida)
    arquivo = saida / "resultado.json"
    if not arquivo.exists():
        raise ErroPipeline("falha_na_gpu", "A nuvem terminou sem devolver o resultado.")
    resultado = json.loads(arquivo.read_text(encoding="utf-8"))
    if resultado.get("etapa") != "pronto":
        raise ErroPipeline(resultado.get("erro", "falha_na_gpu"), resultado.get("mensagem", "O processamento na nuvem não terminou."))
    ply = saida / "cena.ply"
    if not ply.exists():
        raise ErroPipeline("falha_na_gpu", "A nuvem terminou sem o arquivo 3D.")
    splat = comprimir(ply, t.pasta / "cena.sog")
    return Resultado(splat=splat, metricas=resultado, rostos_desfocados=rostos, avisos=relatorio.avisos)
