import * as THREE from 'three';
import { tipoDoSplat } from './tipo';

export interface Interior {
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
export function abrirInterior(canvas: HTMLCanvasElement, opcoes: { url: string; nomeArquivo: string }): Interior {
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
    const sala = new spark.SplatMesh({ url: opcoes.url, fileType: tipo as never });
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
