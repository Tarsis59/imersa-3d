import { lonLatToLocal, type LonLat } from '../geo/project';
import type { Caixa } from '../units/tipos';
import type { Building } from './osm';
import type { AreaEntorno, RelevoEntorno, ViaEntorno } from './cidade';

/** Prédio do entorno como a API entrega: contorno em [lon, lat]. */
export interface PredioEntorno {
  osmId: string;
  alturaM: number;
  contorno: Array<[number, number]>;
}

export interface Entorno {
  centro: LonLat;
  predios: PredioEntorno[];
  atribuicao: string;
  /** Cidade completa (Plano 11b): ruas, verde, água e relevo. Ausentes = só os prédios num chão plano. */
  vias?: ViaEntorno[];
  areas?: AreaEntorno[];
  relevo?: RelevoEntorno | null;
}

/**
 * Prédios do OSM → metros locais nos eixos do modelo (girado `rotacaoGraus`, ver `paraReferenciaDoProjeto`).
 * Tira os que ocupam o lote do empreendimento (`lote` + `folgaM`): o próprio prédio pode já estar no OSM.
 */
export function entornoParaLocal(predios: readonly PredioEntorno[], centro: LonLat, rotacaoGraus: number, lote: Caixa | null, folgaM = 3): Building[] {
  const t = (rotacaoGraus * Math.PI) / 180;
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  const saida: Building[] = [];
  for (const p of predios) {
    const id = Number(/^way\/(\d+)$/.exec(p.osmId)?.[1]);
    if (!Number.isSafeInteger(id) || p.contorno.length < 3 || !(p.alturaM > 0)) continue;
    const footprint = p.contorno.map(([lon, lat]) => {
      const m = lonLatToLocal({ lon, lat }, centro);
      return { x: m.x * cos + m.z * sen, z: -m.x * sen + m.z * cos };
    });
    if (lote) {
      const xs = footprint.map((q) => q.x);
      const zs = footprint.map((q) => q.z);
      const sobre =
        Math.min(...xs) < lote.maxX + folgaM && Math.max(...xs) > lote.minX - folgaM && Math.min(...zs) < lote.maxZ + folgaM && Math.max(...zs) > lote.minZ - folgaM;
      if (sobre) continue;
    }
    saida.push({ id, height: p.alturaM, footprint });
  }
  return saida;
}
