import * as THREE from 'three';
import { semInstancias } from '../xr/maquete';

/**
 * Céu em projeção equirretangular (RGB em float, linhas de cima para baixo): zênite no alto, horizonte no meio e
 * um chão neutro embaixo. É a luz ambiente e o reflexo do path tracing (o céu físico do 3D é um shader, que o
 * path tracer não lê).
 */
export function ceuEquiretangular(largura: number, altura: number, horizonte: THREE.Color, zenite: THREE.Color, chao = new THREE.Color(0x4a4a46)): Float32Array {
  const dados = new Float32Array(largura * altura * 4);
  const c = new THREE.Color();
  for (let y = 0; y < altura; y++) {
    // linha 0 = topo (+90°), última = baixo (−90°)
    const elevacao = (0.5 - (y + 0.5) / altura) * Math.PI;
    if (elevacao >= 0) c.copy(horizonte).lerp(zenite, Math.pow(Math.sin(elevacao), 0.6));
    else c.copy(horizonte).lerp(chao, Math.min(1, -elevacao * 4));
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 4;
      dados[i] = c.r;
      dados[i + 1] = c.g;
      dados[i + 2] = c.b;
      dados[i + 3] = 1;
    }
  }
  return dados;
}

export interface LuzDaFoto {
  /** Direção da luz do sol (de onde vem para onde vai). */
  direcao: THREE.Vector3;
  cor: THREE.Color;
  intensidade: number;
  horizonte: THREE.Color;
  zenite: THREE.Color;
  /** Força do céu como luz ambiente. */
  ceu: number;
}

export interface OpcoesFoto {
  /** Amostras por pixel (mais = menos granulado e mais demora). */
  amostras: number;
  aoProgredir?: (feitas: number, total: number) => void;
  /** Cancelar no meio (a pessoa mexeu ou fechou). */
  sinal?: AbortSignal;
  /** Chamado logo depois da última amostra, na mesma tarefa (o canvas ainda tem a imagem): copiar aqui. */
  aoTerminar: () => void;
}

/**
 * Renderiza a cena em path tracing (luz, sombra suave e reflexos de render) direto no canvas do 3D: a imagem vai
 * "revelando" na tela a cada amostra. Quem chama pausa o desenho normal antes e copia o canvas logo depois.
 */
export async function renderizarFotorrealista(renderer: THREE.WebGLRenderer, objetos: readonly THREE.Object3D[], camera: THREE.PerspectiveCamera, luz: LuzDaFoto, o: OpcoesFoto): Promise<void> {
  const { WebGLPathTracer } = await import('three-gpu-pathtracer');
  const cena = new THREE.Scene();
  for (const ob of objetos) cena.add(semInstancias(ob));
  const ceu = new THREE.DataTexture(ceuEquiretangular(256, 128, luz.horizonte, luz.zenite), 256, 128, THREE.RGBAFormat, THREE.FloatType);
  ceu.mapping = THREE.EquirectangularReflectionMapping;
  ceu.needsUpdate = true;
  cena.environment = ceu;
  cena.background = ceu;
  cena.environmentIntensity = luz.ceu;
  const sol = new THREE.DirectionalLight(luz.cor, luz.intensidade);
  sol.position.copy(luz.direcao).multiplyScalar(-1000);
  cena.add(sol, sol.target);
  cena.updateMatrixWorld(true);

  const tracer = new WebGLPathTracer(renderer);
  tracer.tiles.set(2, 2);
  tracer.bounces = 5;
  tracer.minSamples = 1;
  tracer.fadeDuration = 0;
  tracer.renderDelay = 0;
  tracer.rasterizeScene = false; // até a 1ª amostra, a tela fica com a última imagem normal
  tracer.dynamicLowRes = false;
  tracer.filterGlossyFactor = 0.5; // menos "vagalumes" nos reflexos
  const materiaisCriados = new Set<THREE.Material>();
  cena.traverse((x) => {
    if (x instanceof THREE.Mesh && (x.material as THREE.Material).userData.daMaquete) materiaisCriados.add(x.material as THREE.Material);
  });
  try {
    tracer.setScene(cena, camera);
    while (tracer.samples < o.amostras) {
      if (o.sinal?.aborted) throw new DOMException('foto cancelada', 'AbortError');
      await new Promise((ok) => requestAnimationFrame(ok));
      tracer.renderSample();
      o.aoProgredir?.(Math.min(o.amostras, Math.floor(tracer.samples)), o.amostras);
      if (tracer.samples >= o.amostras) o.aoTerminar();
    }
  } finally {
    tracer.dispose();
    ceu.dispose();
    for (const m of materiaisCriados) m.dispose();
  }
}
