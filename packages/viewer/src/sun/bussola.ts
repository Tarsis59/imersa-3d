import * as THREE from 'three';

const EIXO_Y = new THREE.Vector3(0, 1, 0);
const normalizarGraus = (g: number) => ((g % 360) + 360) % 360;

/**
 * Rumo (graus a partir do norte, sentido horário) para onde a câmera olha.
 * Eixos do modelo: −z é a frente; `rotacaoProjetoGraus` diz para que rumo a frente do modelo aponta.
 */
export function rumoDaCamera(direcao: THREE.Vector3, rotacaoProjetoGraus = 0): number {
  const local = Math.hypot(direcao.x, direcao.z) < 1e-9 ? 0 : THREE.MathUtils.radToDeg(Math.atan2(direcao.x, -direcao.z));
  return normalizarGraus(local + rotacaoProjetoGraus);
}

const PONTOS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'] as const;
export function pontoCardeal(rumo: number): (typeof PONTOS)[number] {
  return PONTOS[Math.round(normalizarGraus(rumo) / 45) % 8]!;
}

/** Direção do mundo (x = leste, z = sul) → eixos do modelo girado `rotacaoProjetoGraus`. */
export function paraReferenciaDoProjeto(direcaoMundo: THREE.Vector3, rotacaoProjetoGraus: number): THREE.Vector3 {
  return direcaoMundo.clone().applyAxisAngle(EIXO_Y, THREE.MathUtils.degToRad(rotacaoProjetoGraus));
}

/** Para onde a sombra aponta no chão (x, z unitários). `null` com o sol abaixo do horizonte ou a pino. */
export function direcaoDaSombra(dirSol: THREE.Vector3): { x: number; z: number } | null {
  const horizontal = Math.hypot(dirSol.x, dirSol.z);
  if (dirSol.y <= 0 || horizontal < 1e-6) return null;
  return { x: -dirSol.x / horizontal, z: -dirSol.z / horizontal };
}
