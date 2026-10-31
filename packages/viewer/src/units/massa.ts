import type { Caixa } from './tipos';

export const ALTURA_ANDAR_M = 3;
const LADO_UNIDADE_M = 8;
const FOLGA_M = 0.2;
const FOLGA_VERTICAL_M = 0.15;

export interface AndarMassa {
  numero: number;
  /** Chaves das unidades do andar (na ordem do espelho). */
  unidades: string[];
}

/**
 * Volumes de um prédio que ainda não tem modelo 3D: cada andar vira uma grade de ceil(√n) colunas,
 * centralizada. O térreo (0) fica no chão; sem térreo, o andar mais baixo fica no chão; subsolos ficam abaixo.
 */
export function massaDoPredio(andares: readonly AndarMassa[]): Map<string, Caixa> {
  const caixas = new Map<string, Caixa>();
  const naoNegativos = andares.map((a) => a.numero).filter((n) => n >= 0);
  const base = naoNegativos.length > 0 ? Math.min(...naoNegativos) : 0;
  for (const andar of [...andares].sort((a, b) => a.numero - b.numero)) {
    const n = andar.unidades.length;
    if (n === 0) continue;
    const colunas = Math.ceil(Math.sqrt(n));
    const linhas = Math.ceil(n / colunas);
    const x0 = (-colunas * LADO_UNIDADE_M) / 2;
    const z0 = (-linhas * LADO_UNIDADE_M) / 2;
    const y0 = (andar.numero - base) * ALTURA_ANDAR_M;
    andar.unidades.forEach((chave, i) => {
      const c = i % colunas;
      const l = Math.floor(i / colunas);
      caixas.set(chave, {
        minX: x0 + c * LADO_UNIDADE_M + FOLGA_M,
        maxX: x0 + (c + 1) * LADO_UNIDADE_M - FOLGA_M,
        minY: y0 + FOLGA_VERTICAL_M,
        maxY: y0 + ALTURA_ANDAR_M - FOLGA_VERTICAL_M,
        minZ: z0 + l * LADO_UNIDADE_M + FOLGA_M,
        maxZ: z0 + (l + 1) * LADO_UNIDADE_M - FOLGA_M,
      });
    });
  }
  return caixas;
}
