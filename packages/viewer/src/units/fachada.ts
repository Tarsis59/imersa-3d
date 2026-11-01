import { ALTURA_ANDAR_M } from './massa';
import type { Caixa } from './tipos';

export type TipoPecaFachada = 'laje' | 'pilar' | 'platibanda' | 'casa-de-maquinas' | 'varanda' | 'guarda-corpo' | 'marquise';

export interface PecaFachada {
  tipo: TipoPecaFachada;
  caixa: Caixa;
}

const BEIRAL_M = 0.45;
const ESPESSURA_LAJE_M = 0.3;
const PILAR_M = 0.4; // cabe sob o beiral da laje, do lado de fora das unidades
const PROFUNDIDADE_VARANDA_M = 1.3;
const LARGURA_VARANDA = 0.7; // da largura da unidade
const ALTURA_GUARDA_CORPO_M = 1.05;
const ESPESSURA_VIDRO_M = 0.04;
const ALTURA_PLATIBANDA_M = 1;
const LADOS = ['+z', '-z', '+x', '-x'] as const;
type Lado = (typeof LADOS)[number];

const centro = (c: Caixa) => ({ x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2 });

function envolver(caixas: readonly Caixa[]): Caixa {
  return {
    minX: Math.min(...caixas.map((c) => c.minX)),
    maxX: Math.max(...caixas.map((c) => c.maxX)),
    minY: Math.min(...caixas.map((c) => c.minY)),
    maxY: Math.max(...caixas.map((c) => c.maxY)),
    minZ: Math.min(...caixas.map((c) => c.minZ)),
    maxZ: Math.max(...caixas.map((c) => c.maxZ)),
  };
}

/** Lado externo de uma unidade (sem vizinha do mesmo andar encostada), na ordem de preferência: frente, fundos, lados. */
export function ladoExterno(unidade: Caixa, doAndar: readonly Caixa[]): Lado | null {
  const c = centro(unidade);
  const largura = unidade.maxX - unidade.minX;
  const fundo = unidade.maxZ - unidade.minZ;
  const vizinha = (dx: number, dz: number) =>
    doAndar.some((o) => o !== unidade && Math.abs(centro(o).x - (c.x + dx)) < largura * 0.3 && Math.abs(centro(o).z - (c.z + dz)) < fundo * 0.3);
  const passo = { x: largura + 0.4, z: fundo + 0.4 };
  const livre: Record<Lado, boolean> = { '+z': !vizinha(0, passo.z), '-z': !vizinha(0, -passo.z), '+x': !vizinha(passo.x, 0), '-x': !vizinha(-passo.x, 0) };
  return LADOS.find((l) => livre[l]) ?? null;
}

/** Varanda (piso em balanço) e guarda-corpo de vidro (frente e laterais) no lado externo da unidade. */
function varanda(u: Caixa, lado: Lado, piso: number): PecaFachada[] {
  const eixoX = lado === '+z' || lado === '-z';
  const sinal = lado.startsWith('+') ? 1 : -1;
  const meio = eixoX ? (u.minX + u.maxX) / 2 : (u.minZ + u.maxZ) / 2;
  const meiaLargura = ((eixoX ? u.maxX - u.minX : u.maxZ - u.minZ) * LARGURA_VARANDA) / 2;
  const face = eixoX ? (sinal > 0 ? u.maxZ : u.minZ) : sinal > 0 ? u.maxX : u.minX;
  const fora = face + sinal * PROFUNDIDADE_VARANDA_M;
  const [p0, p1] = sinal > 0 ? [face, fora] : [fora, face];
  const bloco = (de: number, ate: number, y0: number, y1: number, a0: number, a1: number): Caixa =>
    eixoX ? { minX: a0, maxX: a1, minY: y0, maxY: y1, minZ: de, maxZ: ate } : { minX: de, maxX: ate, minY: y0, maxY: y1, minZ: a0, maxZ: a1 };
  const topo = piso + 0.15;
  const vidro = topo + ALTURA_GUARDA_CORPO_M;
  const borda = sinal > 0 ? [fora - ESPESSURA_VIDRO_M, fora] : [fora, fora + ESPESSURA_VIDRO_M];
  return [
    { tipo: 'varanda', caixa: bloco(p0, p1, piso - 0.15, topo, meio - meiaLargura, meio + meiaLargura) },
    { tipo: 'guarda-corpo', caixa: bloco(borda[0]!, borda[1]!, topo, vidro, meio - meiaLargura, meio + meiaLargura) },
    { tipo: 'guarda-corpo', caixa: bloco(p0, p1, topo, vidro, meio - meiaLargura, meio - meiaLargura + ESPESSURA_VIDRO_M) },
    { tipo: 'guarda-corpo', caixa: bloco(p0, p1, topo, vidro, meio + meiaLargura - ESPESSURA_VIDRO_M, meio + meiaLargura) },
  ];
}

/**
 * Prédio sem modelo 3D desenhado como prédio de verdade a partir dos volumes das unidades: laje com beiral em cada
 * andar, pilares nos cantos, varanda com guarda-corpo de vidro em cada unidade com face externa, laje de cobertura
 * com platibanda e casa de máquinas, e marquise na entrada do térreo.
 */
export function planejarFachada(unidades: Iterable<Caixa>): PecaFachada[] {
  const porAndar = new Map<number, Caixa[]>();
  for (const u of unidades) {
    const andar = Math.round(u.minY / ALTURA_ANDAR_M);
    porAndar.set(andar, [...(porAndar.get(andar) ?? []), u]);
  }
  if (!porAndar.size) return [];
  const andares = [...porAndar.keys()].sort((a, b) => a - b);
  const pecas: PecaFachada[] = [];
  const laje = (f: Caixa, y: number) =>
    pecas.push({ tipo: 'laje', caixa: { minX: f.minX - BEIRAL_M, maxX: f.maxX + BEIRAL_M, minY: y - ESPESSURA_LAJE_M / 2, maxY: y + ESPESSURA_LAJE_M / 2, minZ: f.minZ - BEIRAL_M, maxZ: f.maxZ + BEIRAL_M } });

  for (const [i, andar] of andares.entries()) {
    const doAndar = porAndar.get(andar)!;
    const f = envolver(doAndar);
    const piso = andar * ALTURA_ANDAR_M;
    laje(f, piso);
    const m = PILAR_M / 2;
    for (const [x, z] of [
      [f.minX - m, f.minZ - m],
      [f.maxX + m, f.minZ - m],
      [f.minX - m, f.maxZ + m],
      [f.maxX + m, f.maxZ + m],
    ] as const) {
      pecas.push({ tipo: 'pilar', caixa: { minX: x - PILAR_M / 2, maxX: x + PILAR_M / 2, minY: piso + ESPESSURA_LAJE_M / 2, maxY: piso + ALTURA_ANDAR_M - ESPESSURA_LAJE_M / 2, minZ: z - PILAR_M / 2, maxZ: z + PILAR_M / 2 } });
    }
    // térreo (andar mais baixo): marquise na entrada; nos outros, varandas
    if (i === 0) {
      const largura = Math.min(6, f.maxX - f.minX);
      const meio = (f.minX + f.maxX) / 2;
      pecas.push({ tipo: 'marquise', caixa: { minX: meio - largura / 2, maxX: meio + largura / 2, minY: piso + 2.55, maxY: piso + 2.7, minZ: f.maxZ, maxZ: f.maxZ + 2.5 } });
    } else {
      for (const u of doAndar) {
        const lado = ladoExterno(u, doAndar);
        if (lado) pecas.push(...varanda(u, lado, piso));
      }
    }
  }
  // cobertura: laje, platibanda em volta e casa de máquinas no meio
  const topo = andares[andares.length - 1]!;
  const ft = envolver(porAndar.get(topo)!);
  const yTopo = (topo + 1) * ALTURA_ANDAR_M;
  laje(ft, yTopo);
  const b = { minX: ft.minX - BEIRAL_M, maxX: ft.maxX + BEIRAL_M, minZ: ft.minZ - BEIRAL_M, maxZ: ft.maxZ + BEIRAL_M };
  const y0 = yTopo + ESPESSURA_LAJE_M / 2;
  const y1 = y0 + ALTURA_PLATIBANDA_M;
  const e = 0.2;
  pecas.push(
    { tipo: 'platibanda', caixa: { minX: b.minX, maxX: b.maxX, minY: y0, maxY: y1, minZ: b.minZ, maxZ: b.minZ + e } },
    { tipo: 'platibanda', caixa: { minX: b.minX, maxX: b.maxX, minY: y0, maxY: y1, minZ: b.maxZ - e, maxZ: b.maxZ } },
    { tipo: 'platibanda', caixa: { minX: b.minX, maxX: b.minX + e, minY: y0, maxY: y1, minZ: b.minZ + e, maxZ: b.maxZ - e } },
    { tipo: 'platibanda', caixa: { minX: b.maxX - e, maxX: b.maxX, minY: y0, maxY: y1, minZ: b.minZ + e, maxZ: b.maxZ - e } },
  );
  if (ft.maxX - ft.minX >= 6 && ft.maxZ - ft.minZ >= 6) {
    const c = { x: (ft.minX + ft.maxX) / 2, z: (ft.minZ + ft.maxZ) / 2 };
    pecas.push({ tipo: 'casa-de-maquinas', caixa: { minX: c.x - 1.75, maxX: c.x + 1.75, minY: y0, maxY: y0 + 2.6, minZ: c.z - 1.2, maxZ: c.z + 1.2 } });
  }
  return pecas;
}
