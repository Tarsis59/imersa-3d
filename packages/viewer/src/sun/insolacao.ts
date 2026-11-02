import type { Caixa } from '../units/tipos';

export interface Vetor3 {
  x: number;
  y: number;
  z: number;
}

/** Face externa de uma unidade: ponto no meio da janela e para onde ela olha (horizontal, unitário). */
export interface FaceSolar {
  centro: Vetor3;
  normal: { x: number; z: number };
}

export type PeriodoDeSol = 'manha' | 'tarde' | 'dia-todo' | 'pouco-sol';

/** Horas de sol direto na fachada da unidade em três dias de referência do ano. */
export interface EstudoSolar {
  verao: number;
  inverno: number;
  equinocio: number;
  /** De que parte do dia vem o sol (no equinócio, o dia "médio" do ano). */
  periodo: PeriodoDeSol;
}

/** Datas de referência: solstícios e equinócio de março (no hemisfério sul, dezembro é verão). */
export function diasDeReferencia(hemisferioSul: boolean): { verao: string; inverno: string; equinocio: string } {
  return hemisferioSul ? { verao: '2026-12-21', inverno: '2026-06-21', equinocio: '2026-03-20' } : { verao: '2026-06-21', inverno: '2026-12-21', equinocio: '2026-03-20' };
}

/** O raio (origem `o`, direção `d`) bate em alguma caixa (método das placas). */
export function raioBloqueado(o: Vetor3, d: Vetor3, caixas: readonly Caixa[]): boolean {
  for (const c of caixas) {
    let tMin = 1e-3;
    let tMax = Infinity;
    let fora = false;
    for (const [oo, dd, mn, mx] of [
      [o.x, d.x, c.minX, c.maxX],
      [o.y, d.y, c.minY, c.maxY],
      [o.z, d.z, c.minZ, c.maxZ],
    ] as const) {
      if (Math.abs(dd) < 1e-9) {
        if (oo < mn || oo > mx) {
          fora = true;
          break;
        }
        continue;
      }
      let t1 = (mn - oo) / dd;
      let t2 = (mx - oo) / dd;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) {
        fora = true;
        break;
      }
    }
    if (!fora) return true;
  }
  return false;
}

/**
 * Horas de sol direto numa fachada: a cada `passoMin`, conta se o sol está acima do horizonte, na frente da janela
 * e sem prédio no caminho. `solEm(data, hora)` = direção PARA o sol no referencial da cena (hora local decimal).
 */
export function horasDeSol(face: FaceSolar, obstaculos: readonly Caixa[], solEm: (dataISO: string, hora: number) => Vetor3, dataISO: string, passoMin = 15): { total: number; manha: number } {
  let total = 0;
  let manha = 0;
  // ponto um pouco à frente do vidro: a própria parede não conta como obstáculo
  const o = { x: face.centro.x + face.normal.x * 0.6, y: face.centro.y, z: face.centro.z + face.normal.z * 0.6 };
  for (let min = 4 * 60; min <= 20 * 60; min += passoMin) {
    const hora = min / 60;
    const s = solEm(dataISO, hora);
    if (s.y <= 0.02) continue; // abaixo (ou rente) ao horizonte
    if (s.x * face.normal.x + s.z * face.normal.z <= 0.05) continue; // o sol está atrás da fachada
    if (raioBloqueado(o, s, obstaculos)) continue;
    total += passoMin / 60;
    if (hora < 12) manha += passoMin / 60;
  }
  return { total, manha };
}

const meiaHora = (h: number) => Math.round(h * 2) / 2;

export function estudoSolar(face: FaceSolar, obstaculos: readonly Caixa[], solEm: (dataISO: string, hora: number) => Vetor3, hemisferioSul: boolean): EstudoSolar {
  const dias = diasDeReferencia(hemisferioSul);
  const verao = horasDeSol(face, obstaculos, solEm, dias.verao);
  const inverno = horasDeSol(face, obstaculos, solEm, dias.inverno);
  const equinocio = horasDeSol(face, obstaculos, solEm, dias.equinocio);
  const ref = equinocio.total > 0 ? equinocio : verao;
  let periodo: PeriodoDeSol;
  if (ref.total < 1) periodo = 'pouco-sol';
  else if (ref.manha / ref.total >= 0.7) periodo = 'manha';
  else if ((ref.total - ref.manha) / ref.total >= 0.7) periodo = 'tarde';
  else periodo = 'dia-todo';
  return { verao: meiaHora(verao.total), inverno: meiaHora(inverno.total), equinocio: meiaHora(equinocio.total), periodo };
}
