import { lonLatToLocal, type LonLat, type Local } from '../geo/project';

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export interface OsmData {
  elements: OsmElement[];
}

export interface Building {
  id: number;
  name?: string;
  height: number;
  footprint: Local[];
}

const ALTURA_ANDAR_M = 3;
const ALTURA_PADRAO_M = 9;

export function parseHeight(tags: Record<string, string>): number {
  const h = parseFloat(tags.height ?? '');
  if (Number.isFinite(h) && h > 0) return h;
  const andares = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(andares) && andares > 0) return andares * ALTURA_ANDAR_M;
  return ALTURA_PADRAO_M;
}

export function osmToBuildings(data: OsmData, origem: LonLat): Building[] {
  const nos = new Map<number, LonLat>();
  for (const e of data.elements) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) {
      nos.set(e.id, { lon: e.lon, lat: e.lat });
    }
  }

  const predios: Building[] = [];
  for (const e of data.elements) {
    if (e.type !== 'way' || !e.tags?.building || !e.nodes) continue;
    const ids = e.nodes.length > 1 && e.nodes[0] === e.nodes[e.nodes.length - 1] ? e.nodes.slice(0, -1) : e.nodes;
    if (ids.length < 3) continue;
    const pontos = ids.map((id) => nos.get(id));
    if (pontos.some((p) => p === undefined)) continue;
    predios.push({
      id: e.id,
      name: e.tags.name,
      height: parseHeight(e.tags),
      footprint: (pontos as LonLat[]).map((p) => lonLatToLocal(p, origem)),
    });
  }
  return predios;
}

function centro(b: Building): Local {
  const s = b.footprint.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), { x: 0, z: 0 });
  return { x: s.x / b.footprint.length, z: s.z / b.footprint.length };
}

/** Libera o "lote" onde a torre de exemplo será posicionada. */
export function removeNear(predios: Building[], ponto: Local, raioM: number): Building[] {
  return predios.filter((b) => {
    const c = centro(b);
    return Math.hypot(c.x - ponto.x, c.z - ponto.z) > raioM;
  });
}
