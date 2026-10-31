"""Contas do treino que não precisam de GPU (testadas aqui; usadas pelo script que roda no Kaggle)."""

import numpy as np

#: Coeficiente do harmônico esférico de grau 0.
C0 = 0.28209479177387814
#: Abaixo disso (câmeras posicionadas pelo COLMAP / fotos enviadas), o trabalho para antes do treino na GPU.
MIN_FRACAO_REGISTRADA = 0.7
#: Até isso, compara todas as fotos entre si; acima, só as vizinhas (sequencial), para caber no tempo.
MAX_FOTOS_EXAUSTIVO = 80


def escolher_pareamento(fotos: int) -> str:
    return "exaustivo" if fotos <= MAX_FOTOS_EXAUSTIVO else "sequencial"


def avaliar_registro(registradas: int, total: int) -> tuple[bool, str | None]:
    if total <= 0:
        return False, "Nenhuma foto recebida."
    fracao = registradas / total
    if fracao < MIN_FRACAO_REGISTRADA:
        return False, (
            f"Só {round(fracao * 100)}% das fotos se encaixaram no 3D ({registradas} de {total}). Refaça a captura com "
            "passos curtos, girando devagar e na ordem do caminho, com cada foto repetindo boa parte da anterior."
        )
    return True, None


def escala_da_cena(centros: np.ndarray) -> float:
    """Raio das posições das câmeras (com 10% de folga): referência para o aprendizado e a densificação."""
    meio = centros.mean(axis=0)
    return float(np.linalg.norm(centros - meio, axis=1).max() * 1.1)


def k_redimensionado(K: np.ndarray, fator: float) -> np.ndarray:
    novo = K.astype(float).copy()
    novo[:2] *= fator
    return novo


def viewmat(cam_from_world_3x4: np.ndarray) -> np.ndarray:
    v = np.eye(4)
    v[:3, :4] = cam_from_world_3x4
    return v


def rgb_para_sh0(rgb: np.ndarray) -> np.ndarray:
    """Cor (0–1) → coeficiente de grau 0."""
    return (rgb - 0.5) / C0


def f_rest_para_ply(shN: np.ndarray) -> np.ndarray:
    """[N, coeficientes, 3 canais] (gsplat) → [N, 3·coeficientes] por canal (layout do PLY do 3DGS)."""
    return np.ascontiguousarray(np.transpose(shN, (0, 2, 1)).reshape(len(shN), -1))


def indice_gsplat(versao_torch: str, versao_cuda: str | None) -> str | None:
    """Índice dos pacotes pré-compilados do gsplat para o torch/CUDA do ambiente (evita compilar por minutos)."""
    if not versao_cuda:
        return None
    maior, menor = versao_torch.split("+")[0].split(".")[:2]
    return f"https://docs.gsplat.studio/whl/pt{maior}{menor}cu{versao_cuda.replace('.', '')}"
