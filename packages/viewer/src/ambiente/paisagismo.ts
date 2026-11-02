import type { Caixa } from '../units/tipos';

export interface Arvore {
  x: number;
  z: number;
  altura: number;
  /** Raio da copa. */
  raio: number;
  /** 0..1: variação do verde da copa. */
  tom: number;
}

export interface PlanoPaisagismo {
  /** Retângulos (x, z) do gramado e da calçada em volta do lote. */
  gramado: { minX: number; maxX: number; minZ: number; maxZ: number };
  calcada: { minX: number; maxX: number; minZ: number; maxZ: number };
  arvores: Arvore[];
  postes: Array<{ x: number; z: number }>;
}

const GRAMADO_M = 6;
const CALCADA_M = 3;
const ESPACO_ARVORE_M = 7;
const ESPACO_POSTE_M = 16;
/** Largura livre na frente da entrada (marquise no lado +z). */
const ENTRADA_M = 7;

/** Número pseudoaleatório estável por posição: o paisagismo é sempre o mesmo para o mesmo prédio. */
function ruido(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const dentro = (x: number, z: number, c: Pick<Caixa, 'minX' | 'maxX' | 'minZ' | 'maxZ'>, folga: number) =>
  x > c.minX - folga && x < c.maxX + folga && z > c.minZ - folga && z < c.maxZ + folga;

/** Pontos ao longo do perímetro de um retângulo, a cada `passo` metros (começa no meio do lado). */
function perimetro(r: { minX: number; maxX: number; minZ: number; maxZ: number }, passo: number): Array<{ x: number; z: number }> {
  const pontos: Array<{ x: number; z: number }> = [];
  const lados = [
    { x0: r.minX, z0: r.minZ, x1: r.maxX, z1: r.minZ },
    { x0: r.maxX, z0: r.minZ, x1: r.maxX, z1: r.maxZ },
    { x0: r.maxX, z0: r.maxZ, x1: r.minX, z1: r.maxZ },
    { x0: r.minX, z0: r.maxZ, x1: r.minX, z1: r.minZ },
  ];
  for (const l of lados) {
    const comprimento = Math.hypot(l.x1 - l.x0, l.z1 - l.z0);
    const n = Math.max(1, Math.floor(comprimento / passo));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      pontos.push({ x: l.x0 + (l.x1 - l.x0) * t, z: l.z0 + (l.z1 - l.z0) * t });
    }
  }
  return pontos;
}

/**
 * Paisagismo do lote: gramado em volta do prédio, calçada, árvores na borda do gramado (altura e tom variados,
 * sempre os mesmos para o mesmo prédio) e postes na calçada. Nada na frente da entrada (lado +z) nem dentro dos
 * prédios vizinhos (`obstaculos`).
 */
export function planejarPaisagismo(predio: Caixa, obstaculos: readonly Caixa[] = []): PlanoPaisagismo {
  const gramado = { minX: predio.minX - GRAMADO_M, maxX: predio.maxX + GRAMADO_M, minZ: predio.minZ - GRAMADO_M, maxZ: predio.maxZ + GRAMADO_M };
  const calcada = { minX: gramado.minX - CALCADA_M, maxX: gramado.maxX + CALCADA_M, minZ: gramado.minZ - CALCADA_M, maxZ: gramado.maxZ + CALCADA_M };
  const meioX = (predio.minX + predio.maxX) / 2;
  const livre = (x: number, z: number, raio: number) =>
    !dentro(x, z, predio, raio + 1) && !(z > predio.maxZ && Math.abs(x - meioX) < ENTRADA_M / 2 + raio) && !obstaculos.some((o) => dentro(x, z, o, raio));
  // árvores: na borda do gramado, um pouco para dentro
  const borda = { minX: gramado.minX + 1.5, maxX: gramado.maxX - 1.5, minZ: gramado.minZ + 1.5, maxZ: gramado.maxZ - 1.5 };
  const arvores: Arvore[] = [];
  for (const p of perimetro(borda, ESPACO_ARVORE_M)) {
    const r = ruido(p.x, p.z);
    const raio = 1.6 + r * 1.2;
    const x = p.x + (ruido(p.z, p.x) - 0.5) * 1.2;
    const z = p.z + (ruido(p.x + 3, p.z - 7) - 0.5) * 1.2;
    if (livre(x, z, raio)) arvores.push({ x, z, altura: 4.5 + r * 3.5, raio, tom: ruido(p.x - 11, p.z + 5) });
  }
  // postes: no meio da calçada
  const meioCalcada = { minX: calcada.minX + CALCADA_M / 2, maxX: calcada.maxX - CALCADA_M / 2, minZ: calcada.minZ + CALCADA_M / 2, maxZ: calcada.maxZ - CALCADA_M / 2 };
  const postes = perimetro(meioCalcada, ESPACO_POSTE_M).filter((p) => !obstaculos.some((o) => dentro(p.x, p.z, o, 0.5)));
  return { gramado, calcada, arvores, postes };
}
