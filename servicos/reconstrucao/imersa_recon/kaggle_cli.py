"""Acesso ao Kaggle pelo cliente oficial (kaggle 2.x, Apache-2.0). Login feito antes com `kaggle auth login`."""

import subprocess
from collections.abc import Callable
from pathlib import Path

#: GPU gratuita do Kaggle (NVIDIA T4).
ACELERADOR = "NvidiaTeslaT4"


class KaggleCli:
    def __init__(self, executavel: str = "kaggle", executar: Callable[..., subprocess.CompletedProcess] = subprocess.run, limite_kernel_s: int = 4 * 3600):
        self.executavel, self._executar, self.limite_kernel_s = executavel, executar, limite_kernel_s

    def _rodar(self, *args: str, limite_s: int = 600) -> str:
        r = self._executar([self.executavel, *args], capture_output=True, text=True, timeout=limite_s)
        if r.returncode != 0:
            # a mensagem do cliente pode trazer dados da conta: não repassar o texto bruto
            motivo = "sem login (rode `kaggle auth login`)" if "401" in (r.stderr or "") or "Unauthorized" in (r.stderr or "") else f"código {r.returncode}"
            raise RuntimeError(f"Kaggle recusou `{' '.join(args[:2])}`: {motivo}")
        return r.stdout or ""

    def criar_dataset(self, pasta: Path) -> None:
        # envio das fotos: pode demorar numa internet doméstica
        self._rodar("datasets", "create", "-p", str(pasta), "-r", "zip", "-q", limite_s=3 * 3600)

    def dataset_pronto(self, id_dataset: str) -> bool:
        return "ready" in self._rodar("datasets", "status", id_dataset).lower()

    def enviar_kernel(self, pasta: Path) -> None:
        self._rodar("kernels", "push", "-p", str(pasta), "--accelerator", ACELERADOR, "-t", str(self.limite_kernel_s))

    def status(self, id_kernel: str) -> str:
        return self._rodar("kernels", "status", id_kernel).strip().lower()

    def baixar_saida(self, id_kernel: str, destino: Path) -> None:
        destino.mkdir(parents=True, exist_ok=True)
        self._rodar("kernels", "output", id_kernel, "-p", str(destino), "-o", "-q", limite_s=3600)
