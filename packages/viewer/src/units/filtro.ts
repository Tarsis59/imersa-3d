import type { StatusUnidade, UnidadeViewer } from './tipos';

export interface Filtro {
  /** Vazio = qualquer número de quartos. */
  quartos: number[];
  areaMin: number | null;
  precoMax: number | null;
  /** Vazio = qualquer status. */
  status: StatusUnidade[];
  somenteFavoritos: boolean;
}

export const filtroVazio = (): Filtro => ({ quartos: [], areaMin: null, precoMax: null, status: [], somenteFavoritos: false });

/**
 * IDs das unidades que passam no filtro. Critérios diferentes combinam com E; opções do mesmo critério, com OU.
 * Unidade sem o dado não passa num filtro desse dado: não dá para garantir ao cliente.
 */
export function filtrar(unidades: readonly UnidadeViewer[], f: Filtro, favoritos: ReadonlySet<string> = new Set()): Set<string> {
  const passam = new Set<string>();
  for (const u of unidades) {
    if (f.quartos.length > 0 && (u.quartos === null || !f.quartos.includes(u.quartos))) continue;
    if (f.areaMin !== null && (u.areaM2 === null || u.areaM2 < f.areaMin)) continue;
    if (f.precoMax !== null && (u.preco === null || u.preco > f.precoMax)) continue;
    if (f.status.length > 0 && !f.status.includes(u.status)) continue;
    if (f.somenteFavoritos && !favoritos.has(u.id)) continue;
    passam.add(u.id);
  }
  return passam;
}
