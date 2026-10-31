"""
Fotos → 3D (Gaussian Splatting) na GPU gratuita do Kaggle.

Entrada (dataset privado anexado ao notebook, montado em /kaggle/input/<dataset>/):
  fotos/            fotos já com os rostos desfocados (LGPD, feito antes de sair do servidor)
  sparse/0/         opcional: câmeras já calculadas pelo COLMAP (pula a etapa 1)
  codigo/           o pacote imersa_recon (contas testadas fora da GPU)
  config.json       {"iteracoes": 7000, "lado_maximo": 1600, "grau_sh": 3}

Saída (/kaggle/working/, baixada pelo orquestrador):
  cena.ply          splat treinado (padrão 3DGS)
  resultado.json    etapa, mensagem, métricas e tempos (gravado a cada etapa)

Etapas: 1) COLMAP (CPU) posiciona as câmeras; se menos de 70% das fotos se encaixarem, PARA aqui, sem gastar
o treino na GPU. 2) treino com gsplat (Apache-2.0). 3) exportação do PLY.
"""

import json
import os
import random
import subprocess
import sys
import time
from pathlib import Path

INICIO = time.time()
SAIDA = Path("/kaggle/working")
RESULTADO: dict = {"etapa": "preparando", "tempos_s": {}}


def gravar(**mudancas) -> None:
    RESULTADO.update(mudancas)
    RESULTADO["decorrido_s"] = round(time.time() - INICIO, 1)
    (SAIDA / "resultado.json").write_text(json.dumps(RESULTADO, ensure_ascii=False, indent=2))
    print("[imersa]", json.dumps({k: v for k, v in RESULTADO.items() if k != "tempos_s"}, ensure_ascii=False), flush=True)


def falhar(codigo: str, mensagem: str) -> None:
    gravar(etapa="erro", erro=codigo, mensagem=mensagem)
    sys.exit(0)  # sai "com sucesso" para o Kaggle guardar o resultado.json


def achar_entrada() -> Path:
    for pasta in Path("/kaggle/input").rglob("config.json"):
        if (pasta.parent / "fotos").is_dir():
            return pasta.parent
    falhar("entrada_ausente", "Dataset de entrada não encontrado (precisa de fotos/ e config.json).")
    raise SystemExit


def instalar() -> None:
    import torch

    from imersa_recon.treino_util import indice_gsplat

    indice = indice_gsplat(torch.__version__, torch.version.cuda)
    pip = [sys.executable, "-m", "pip", "install", "-q"]
    subprocess.run([*pip, "pycolmap==4.2.1"], check=True)
    if indice and subprocess.run([*pip, "gsplat==1.5.3", "--index-url", indice, "--extra-index-url", "https://pypi.org/simple"]).returncode == 0:
        return
    subprocess.run([*pip, "ninja", "gsplat==1.5.3"], check=True)  # sem pré-compilado: compila na 1ª execução


def posicionar_cameras(entrada: Path, trabalho: Path, fotos: list[str]):
    import pycolmap

    from imersa_recon.treino_util import avaliar_registro, escolher_pareamento

    esparso = entrada / "sparse" / "0"
    if esparso.is_dir():
        reconstrucao = pycolmap.Reconstruction(str(esparso))
    else:
        banco = trabalho / "database.db"
        pycolmap.extract_features(str(banco), str(entrada / "fotos"), camera_mode=pycolmap.CameraMode.SINGLE)
        if escolher_pareamento(len(fotos)) == "exaustivo":
            pycolmap.match_exhaustive(str(banco))
        else:
            pycolmap.match_sequential(str(banco))
        (trabalho / "sparse").mkdir(exist_ok=True)
        mapas = pycolmap.incremental_mapping(str(banco), str(entrada / "fotos"), str(trabalho / "sparse"))
        if not mapas:
            falhar("sem_reconstrucao", "Nenhuma foto se encaixou no 3D. Refaça com passos curtos e boa sobreposição.")
        reconstrucao = max(mapas.values(), key=lambda r: r.num_reg_images())
    ok, mensagem = avaliar_registro(reconstrucao.num_reg_images(), len(fotos))
    gravar(fotos=len(fotos), registradas=reconstrucao.num_reg_images())
    if not ok:
        falhar("poucas_fotos_encaixadas", mensagem)
    modelos = {c.model.name for c in reconstrucao.cameras.values()}
    if not modelos <= {"PINHOLE", "SIMPLE_PINHOLE"}:
        # lente com distorção → imagens retificadas (o rasterizador assume câmera pinhole)
        retificadas = trabalho / "retificadas"
        pasta = trabalho / "sparse_tmp"
        pasta.mkdir(exist_ok=True)
        reconstrucao.write(str(pasta))
        pycolmap.undistort_images(str(retificadas), str(pasta), str(entrada / "fotos"))
        return pycolmap.Reconstruction(str(retificadas / "sparse")), retificadas / "images"
    return reconstrucao, entrada / "fotos"


def ssim(a, b):
    import torch
    import torch.nn.functional as F

    g = torch.exp(-((torch.arange(11, device=a.device) - 5.0) ** 2) / (2 * 1.5**2))
    janela = (g[:, None] @ g[None, :]) / g.sum() ** 2
    janela = janela.expand(3, 1, 11, 11)
    media = lambda x: F.conv2d(x, janela, padding=5, groups=3)  # noqa: E731
    ma, mb = media(a), media(b)
    va, vb, cov = media(a * a) - ma**2, media(b * b) - mb**2, media(a * b) - ma * mb
    c1, c2 = 0.01**2, 0.03**2
    return (((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma**2 + mb**2 + c1) * (va + vb + c2))).mean()


def treinar(reconstrucao, pasta_fotos: Path, config: dict) -> None:
    import cv2
    import numpy as np
    import torch
    from gsplat import DefaultStrategy, rasterization

    from imersa_recon.ply import escrever_ply_3dgs
    from imersa_recon.treino_util import escala_da_cena, f_rest_para_ply, k_redimensionado, rgb_para_sh0, viewmat

    dispositivo = torch.device("cuda")
    gravar(etapa="treino", gpu=torch.cuda.get_device_name(0))
    lado = int(config.get("lado_maximo", 1600))
    iteracoes = int(config.get("iteracoes", 7000))
    grau = int(config.get("grau_sh", 3))

    vistas = []
    for img_id in reconstrucao.reg_image_ids():
        imagem = reconstrucao.images[img_id]
        camera = reconstrucao.cameras[imagem.camera_id]
        bgr = cv2.imread(str(pasta_fotos / imagem.name))
        if bgr is None:
            continue
        fator = min(1.0, lado / max(bgr.shape[:2]))
        if fator < 1:
            bgr = cv2.resize(bgr, None, fx=fator, fy=fator, interpolation=cv2.INTER_AREA)
        fator_real = bgr.shape[1] / camera.width
        vistas.append(
            dict(
                rgb=torch.from_numpy(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)),  # uint8 na CPU; vai para a GPU a cada passo
                K=torch.tensor(k_redimensionado(camera.calibration_matrix(), fator_real), dtype=torch.float32, device=dispositivo),
                viewmat=torch.tensor(viewmat(imagem.cam_from_world().matrix()), dtype=torch.float32, device=dispositivo),
                centro=imagem.projection_center().reshape(3),
            )
        )
    escala = escala_da_cena(np.array([v["centro"] for v in vistas]))

    pontos = list(reconstrucao.points3D.values())
    xyz = torch.tensor(np.array([p.xyz for p in pontos]), dtype=torch.float32, device=dispositivo)
    cores = torch.tensor(rgb_para_sh0(np.array([p.color for p in pontos]) / 255.0), dtype=torch.float32, device=dispositivo)
    # escala inicial: distância média aos 3 vizinhos mais próximos (em blocos, para caber na memória)
    dist = []
    for bloco in torch.split(xyz, 1024):
        d = torch.cdist(bloco, xyz)
        dist.append(d.topk(4, largest=False).values[:, 1:].mean(1))
    escala_inicial = torch.log(torch.cat(dist).clamp_min(1e-7))[:, None].repeat(1, 3)
    n = len(xyz)
    params = torch.nn.ParameterDict(
        {
            "means": torch.nn.Parameter(xyz),
            "scales": torch.nn.Parameter(escala_inicial),
            "quats": torch.nn.Parameter(torch.tensor([[1.0, 0, 0, 0]], device=dispositivo).repeat(n, 1)),
            "opacities": torch.nn.Parameter(torch.logit(torch.full((n,), 0.1, device=dispositivo))),
            "sh0": torch.nn.Parameter(cores[:, None, :]),
            "shN": torch.nn.Parameter(torch.zeros((n, (grau + 1) ** 2 - 1, 3), device=dispositivo)),
        }
    )
    taxas = {"means": 1.6e-4 * escala, "scales": 5e-3, "quats": 1e-3, "opacities": 5e-2, "sh0": 2.5e-3, "shN": 2.5e-3 / 20}
    otimizadores = {k: torch.optim.Adam([{"params": params[k], "lr": lr, "name": k}], eps=1e-15) for k, lr in taxas.items()}
    agenda_means = torch.optim.lr_scheduler.ExponentialLR(otimizadores["means"], gamma=0.01 ** (1.0 / iteracoes))
    estrategia = DefaultStrategy(refine_stop_iter=min(15_000, iteracoes // 2), verbose=False)
    estrategia.check_sanity(params, otimizadores)
    estado = estrategia.initialize_state(scene_scale=escala)

    ultimo_psnr = 0.0
    for passo in range(iteracoes):
        v = random.choice(vistas)
        alvo = v["rgb"].to(dispositivo, non_blocking=True).float() / 255.0
        altura, largura = alvo.shape[:2]
        imagem, _, info = rasterization(
            means=params["means"],
            quats=params["quats"],
            scales=torch.exp(params["scales"]),
            opacities=torch.sigmoid(params["opacities"]),
            colors=torch.cat([params["sh0"], params["shN"]], 1),
            viewmats=v["viewmat"][None],
            Ks=v["K"][None],
            width=largura,
            height=altura,
            sh_degree=min(passo // 1000, grau),
            packed=False,
        )
        estrategia.step_pre_backward(params, otimizadores, estado, passo, info)
        saida = imagem[0]
        l1 = (saida - alvo).abs().mean()
        perda = 0.8 * l1 + 0.2 * (1 - ssim(saida.permute(2, 0, 1)[None], alvo.permute(2, 0, 1)[None]))
        perda.backward()
        estrategia.step_post_backward(params, otimizadores, estado, passo, info, packed=False)
        for o in otimizadores.values():
            o.step()
            o.zero_grad(set_to_none=True)
        agenda_means.step()
        if passo % 500 == 0 or passo == iteracoes - 1:
            with torch.no_grad():
                ultimo_psnr = float(-10 * torch.log10(((saida - alvo) ** 2).mean()))
            gravar(passo=passo, iteracoes=iteracoes, gaussianas=len(params["means"]), psnr=round(ultimo_psnr, 2))

    with torch.no_grad():
        escrever_ply_3dgs(
            SAIDA / "cena.ply",
            xyz=params["means"].cpu().numpy(),
            f_dc=params["sh0"][:, 0, :].cpu().numpy(),
            f_rest=f_rest_para_ply(params["shN"].cpu().numpy()),
            opacidade=params["opacities"].cpu().numpy(),
            escala=params["scales"].cpu().numpy(),
            rotacao=torch.nn.functional.normalize(params["quats"], dim=-1).cpu().numpy(),
        )
    gravar(gaussianas=len(params["means"]), psnr=round(ultimo_psnr, 2), vistas=len(vistas), escala_cena=round(escala, 3))


def principal() -> None:
    SAIDA.mkdir(parents=True, exist_ok=True)
    entrada = achar_entrada()
    sys.path.insert(0, str(entrada / "codigo"))
    config = json.loads((entrada / "config.json").read_text())
    fotos = sorted(p.name for p in (entrada / "fotos").iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    gravar(etapa="instalando", fotos=len(fotos))
    t = time.time()
    instalar()
    RESULTADO["tempos_s"]["instalar"] = round(time.time() - t, 1)
    gravar(etapa="posicionando_cameras")
    t = time.time()
    trabalho = Path("/kaggle/temp/imersa")
    trabalho.mkdir(parents=True, exist_ok=True)
    reconstrucao, pasta_fotos = posicionar_cameras(entrada, trabalho, fotos)
    RESULTADO["tempos_s"]["cameras"] = round(time.time() - t, 1)
    t = time.time()
    treinar(reconstrucao, pasta_fotos, config)
    RESULTADO["tempos_s"]["treino"] = round(time.time() - t, 1)
    gravar(etapa="pronto", mensagem="Splat treinado.", tamanho_ply_mb=round(os.path.getsize(SAIDA / "cena.ply") / 2**20, 1))


if __name__ == "__main__":
    try:
        principal()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — qualquer falha vira um resultado legível para o orquestrador
        import traceback

        traceback.print_exc()
        falhar("falha_inesperada", f"{type(e).__name__}: {e}"[:500])
