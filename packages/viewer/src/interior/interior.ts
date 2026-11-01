import * as THREE from 'three';
import { tipoDoSplat } from './tipo';

/**
 * Splats a partir deste tamanho ganham a árvore de nível de detalhe (LoD) do Spark, montada num worker sem travar a
 * tela: de longe vão menos pontos, de perto mais, dentro do orçamento do aparelho (celular ~1 a 1,5 milhão,
 * computador ~2,5 milhões). Assim um splat de 10 milhões abre no celular. Abaixo disso, carrega inteiro.
 */
export const LOD_A_PARTIR_DE = 1_000_000;

/** Opções de LoD do splat; `lodAcima` = 0 força a árvore em qualquer tamanho (conferência). */
export const opcoesDeLod = (lodAcima = LOD_A_PARTIR_DE) => ({ lod: true as const, lodAbove: Math.max(0, lodAcima) });

export interface Interior {
  /** Splat com árvore de nível de detalhe (grande o bastante para precisar dela). */
  comLod(): boolean;
  /** Resolve quando o splat está na tela; rejeita se o arquivo não abrir. */
  pronto: Promise<void>;
  /** Vira a cena de cabeça para baixo (algumas capturas vêm invertidas). */
  girar(): void;
  destruir(): void;
}

/**
 * Interior real reconstruído de fotos (Gaussian Splatting). A biblioteca de splats (Spark, MIT) é a maior parte
 * do JS do 3D, então só é baixada aqui, quando a pessoa pede para entrar.
 */
export function abrirInterior(canvas: HTMLCanvasElement, opcoes: { url: string; nomeArquivo: string; lodAcima?: number }): Interior {
  const tipo = tipoDoSplat(opcoes.nomeArquivo);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const cena = new THREE.Scene();
  cena.background = new THREE.Color(0x111111);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 1000);
  let destruido = false;
  let malha: THREE.Object3D | null = null;
  let controles: { update(c: THREE.Camera): void } | null = null;

  const redimensionar = () => {
    const pai = canvas.parentElement ?? canvas;
    const w = Math.max(1, pai.clientWidth);
    const h = Math.max(1, pai.clientHeight);
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observador = new ResizeObserver(redimensionar);
  observador.observe(canvas.parentElement ?? canvas);
  redimensionar();

  const pronto = (async () => {
    if (!tipo) throw new Error('Formato de splat não suportado');
    const spark = await import('@sparkjsdev/spark');
    if (destruido) return;
    cena.add(new spark.SparkRenderer({ renderer }));
    const sala = new spark.SplatMesh({ url: opcoes.url, fileType: tipo as never, ...opcoesDeLod(opcoes.lodAcima) });
    cena.add(sala);
    malha = sala;
    controles = new spark.SparkControls({ canvas });
    await sala.initialized;
    if (destruido) return;
    renderer.setAnimationLoop(() => {
      controles?.update(camera);
      renderer.render(cena, camera);
    });
  })();

  return {
    pronto,
    comLod() {
      const m = malha as { packedSplats?: { lodSplats?: unknown }; extSplats?: { lodSplats?: unknown } } | null;
      return Boolean(m?.packedSplats?.lodSplats ?? m?.extSplats?.lodSplats);
    },
    girar() {
      malha?.rotateX(Math.PI);
    },
    destruir() {
      destruido = true;
      renderer.setAnimationLoop(null);
      observador.disconnect();
      if (malha) cena.remove(malha);
      (malha as { dispose?: () => void } | null)?.dispose?.();
      renderer.dispose();
    },
  };
}
