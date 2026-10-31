"""PLY binário no padrão do 3D Gaussian Splatting (o que gsplat, Spark e splat-transform leem). Só NumPy."""

from pathlib import Path

import numpy as np


def propriedades(grau_sh: int) -> list[str]:
    extras = 3 * ((grau_sh + 1) ** 2 - 1)
    return (
        ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2"]
        + [f"f_rest_{i}" for i in range(extras)]
        + ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    )


def escrever_ply_3dgs(
    caminho: Path,
    xyz: np.ndarray,
    f_dc: np.ndarray,
    f_rest: np.ndarray,
    opacidade: np.ndarray,
    escala: np.ndarray,
    rotacao: np.ndarray,
) -> None:
    """
    `f_rest` no layout do 3DGS (por canal: R de todos os coeficientes, depois G, depois B), `opacidade` antes da
    sigmoide, `escala` em log, `rotacao` quatérnio (w, x, y, z).
    """
    n = len(xyz)
    for nome, v, colunas in (("f_dc", f_dc, 3), ("opacidade", opacidade, None), ("escala", escala, 3), ("rotacao", rotacao, 4)):
        if len(v) != n or (colunas and v.shape[1] != colunas):
            raise ValueError(f"{nome} com formato {v.shape}, esperado ({n}, {colunas or ''})")
    if len(f_rest) != n or f_rest.shape[1] % 3:
        raise ValueError(f"f_rest com formato {f_rest.shape}")
    grau = int(round((f_rest.shape[1] // 3 + 1) ** 0.5)) - 1
    if 3 * ((grau + 1) ** 2 - 1) != f_rest.shape[1]:
        raise ValueError(f"f_rest com {f_rest.shape[1]} colunas não corresponde a nenhum grau de SH")
    nomes = propriedades(grau)
    dados = np.concatenate(
        [xyz, np.zeros((n, 3), np.float32), f_dc, f_rest, opacidade.reshape(n, 1), escala, rotacao], axis=1
    ).astype("<f4")
    cabecalho = "ply\nformat binary_little_endian 1.0\nelement vertex %d\n%send_header\n" % (
        n,
        "".join(f"property float {p}\n" for p in nomes),
    )
    with open(caminho, "wb") as f:
        f.write(cabecalho.encode("ascii"))
        f.write(np.ascontiguousarray(dados).tobytes())


def ler_ply_3dgs(caminho: Path) -> dict[str, np.ndarray]:
    bruto = Path(caminho).read_bytes()
    fim = bruto.index(b"end_header\n") + len(b"end_header\n")
    linhas = bruto[:fim].decode("ascii").splitlines()
    n = int(next(x for x in linhas if x.startswith("element vertex")).split()[-1])
    nomes = [x.split()[-1] for x in linhas if x.startswith("property float")]
    dados = np.frombuffer(bruto, "<f4", count=n * len(nomes), offset=fim).reshape(n, len(nomes))
    col = {nome: i for i, nome in enumerate(nomes)}
    pegar = lambda prefixo: dados[:, [i for nome, i in col.items() if nome.startswith(prefixo)]]  # noqa: E731
    return {
        "xyz": dados[:, [col["x"], col["y"], col["z"]]].copy(),
        "f_dc": pegar("f_dc_").copy(),
        "f_rest": pegar("f_rest_").copy(),
        "opacidade": dados[:, col["opacity"]].copy(),
        "escala": pegar("scale_").copy(),
        "rotacao": pegar("rot_").copy(),
    }
