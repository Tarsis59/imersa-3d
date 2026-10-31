import subprocess
from pathlib import Path

import pytest

from imersa_recon.kaggle_cli import KaggleCli


class Gravador:
    def __init__(self, saidas: dict[str, str]):
        self.saidas, self.comandos = saidas, []

    def __call__(self, comando, **_):
        self.comandos.append(comando[1:])
        chave = " ".join(comando[1:3])
        return subprocess.CompletedProcess(comando, 0, self.saidas.get(chave, ""), "")


def test_comandos_do_kaggle(tmp_path: Path):
    g = Gravador({"datasets status": "ready\n", "kernels status": 'imersa/imersa-treino-x has status "KernelWorkerStatus.COMPLETE"\n'})
    k = KaggleCli("kaggle", executar=g, limite_kernel_s=7200)
    k.criar_dataset(tmp_path)
    assert k.dataset_pronto("imersa/imersa-x")
    k.enviar_kernel(tmp_path)
    assert "complete" in k.status("imersa/imersa-treino-x")
    k.baixar_saida("imersa/imersa-treino-x", tmp_path / "saida")
    assert g.comandos == [
        ["datasets", "create", "-p", str(tmp_path), "-r", "zip", "-q"],
        ["datasets", "status", "imersa/imersa-x"],
        ["kernels", "push", "-p", str(tmp_path), "--accelerator", "NvidiaTeslaT4", "-t", "7200"],
        ["kernels", "status", "imersa/imersa-treino-x"],
        ["kernels", "output", "imersa/imersa-treino-x", "-p", str(tmp_path / "saida"), "-o", "-q"],
    ]


def test_falha_do_comando_vira_erro_claro_sem_vazar_credencial(tmp_path: Path):
    def falha(comando, **_):
        return subprocess.CompletedProcess(comando, 1, "", "401 Unauthorized: token abc123")

    k = KaggleCli("kaggle", executar=falha)
    with pytest.raises(RuntimeError, match="Kaggle recusou") as e:
        k.criar_dataset(tmp_path)
    assert "abc123" not in str(e.value)
