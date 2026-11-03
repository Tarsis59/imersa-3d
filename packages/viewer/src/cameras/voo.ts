import * as THREE from 'three';
import type { Caixa } from '../units/tipos';

export interface Pose {
  posicao: THREE.Vector3;
  alvo: THREE.Vector3;
}

/** Ease-in-out cúbico: começa e termina devagar. */
export function suavizar(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Trajeto de câmera entre duas poses. Retorna a pose para t ∈ [0, 1] (fora disso é limitado).
 * No meio sobe em arco (¼ da distância, mínimo 10 m) para passar por cima dos prédios.
 */
export function planejarVoo(de: Pose, para: Pose): (t: number) => Pose {
  const arco = Math.max(10, de.posicao.distanceTo(para.posicao) * 0.25);
  return (t) => {
    const e = suavizar(THREE.MathUtils.clamp(t, 0, 1));
    const posicao = de.posicao.clone().lerp(para.posicao, e);
    posicao.y += arco * Math.sin(Math.PI * e);
    return { posicao, alvo: de.alvo.clone().lerp(para.alvo, e) };
  };
}

/**
 * Pose que mostra a caixa inteira, vinda do sudeste, `elevacaoGraus` acima do horizonte.
 * Para uma unidade, 20° (quase de frente): de cima, os andares superiores a esconderiam.
 * `margem` multiplica a distância mínima (1,15 = justo; maior = mostra o entorno).
 */
export function enquadrar(caixa: Caixa, fovGraus: number, aspecto: number, elevacaoGraus = 20, margem = 1.15): Pose {
  const alvo = new THREE.Vector3((caixa.minX + caixa.maxX) / 2, (caixa.minY + caixa.maxY) / 2, (caixa.minZ + caixa.maxZ) / 2);
  const raio = Math.hypot(caixa.maxX - caixa.minX, caixa.maxY - caixa.minY, caixa.maxZ - caixa.minZ) / 2;
  const vertical = THREE.MathUtils.degToRad(fovGraus);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspecto);
  const distancia = (raio / Math.sin(Math.min(vertical, horizontal) / 2)) * margem;
  const el = THREE.MathUtils.degToRad(elevacaoGraus);
  const direcao = new THREE.Vector3(Math.cos(el) * Math.SQRT1_2, Math.sin(el), Math.cos(el) * Math.SQRT1_2);
  return { posicao: alvo.clone().addScaledVector(direcao, distancia), alvo };
}

export interface EnquadramentoOrtografico {
  /** Bem acima do centro da caixa, olhando para baixo. */
  posicao: THREE.Vector3;
  /** No piso da caixa (minY), no centro em X/Z. */
  alvo: THREE.Vector3;
  /** Metade da altura do volume de visão, em metros do mundo: `top`/`-bottom` da câmera ortográfica; com o
   * `aspecto` da tela dá o `left`/`right` (× aspecto). */
  meiaAlturaMundo: number;
}

/**
 * Planta 3D humanizada (Plano 12c, item 3): câmera ortográfica de cima, enquadrando a caixa toda (o pavimento)
 * com a margem, do jeito certo pra tela larga ou estreita. Pura: só os números, quem monta a
 * `THREE.OrthographicCamera` aplica `posicao`/`alvo`/`meiaAlturaMundo`.
 */
export function enquadrarDeCima(caixa: Caixa, aspecto: number, margem = 1.1): EnquadramentoOrtografico {
  const cx = (caixa.minX + caixa.maxX) / 2;
  const cz = (caixa.minZ + caixa.maxZ) / 2;
  const alvo = new THREE.Vector3(cx, caixa.minY, cz);
  const distanciaAcima = Math.max(20, (caixa.maxY - caixa.minY) + 15); // alto o bastante para não raspar o telhado
  const posicao = new THREE.Vector3(cx, caixa.maxY + distanciaAcima, cz);
  const largura = (caixa.maxX - caixa.minX) * margem;
  const profundidade = (caixa.maxZ - caixa.minZ) * margem;
  const meiaAlturaMundo = Math.max(profundidade / 2, largura / (2 * Math.max(aspecto, 1e-6)));
  return { posicao, alvo, meiaAlturaMundo };
}
