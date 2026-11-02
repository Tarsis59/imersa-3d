/**
 * Ponte entre o chão geográfico (lon/lat) e os eixos locais do 3D do prédio (metros, giro do projeto) — a mesma
 * conta que o viewer faz em `lonLatToLocal`/`paraModelo` (packages/viewer/src/geo/project.ts e city/cidade.ts),
 * refeita aqui no lado da API para cruzar o clube (marcado nos eixos do prédio) com os lotes (em lon/lat).
 */

export interface LonLat {
  lon: number;
  lat: number;
}

const METROS_POR_GRAU_LAT = 110_540;
const METROS_POR_GRAU_LON_EQUADOR = 111_320;

/** Ponto marcado nos eixos do 3D do prédio (x leste, z sul, já girado) → lon/lat, dado o centro e o giro do projeto. */
export function modeloParaLonLat(p: { x: number; z: number }, centro: LonLat, rotacaoGraus: number): LonLat {
  const t = (rotacaoGraus * Math.PI) / 180;
  // eixos do modelo → chão local (inversa de `paraModelo`)
  const lx = p.x * Math.cos(t) - p.z * Math.sin(t);
  const lz = p.x * Math.sin(t) + p.z * Math.cos(t);
  // chão local → lon/lat (inversa de `lonLatToLocal`)
  const cosLat = Math.cos((centro.lat * Math.PI) / 180);
  return { lon: centro.lon + lx / (METROS_POR_GRAU_LON_EQUADOR * cosLat), lat: centro.lat - lz / METROS_POR_GRAU_LAT };
}

/** Distância em linha reta (metros) entre dois pontos lon/lat perto um do outro (projeção local, erro < 0,1%). */
export function distanciaLonLatM(a: LonLat, b: LonLat): number {
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  const dx = (b.lon - a.lon) * METROS_POR_GRAU_LON_EQUADOR * cosLat;
  const dy = (b.lat - a.lat) * METROS_POR_GRAU_LAT;
  return Math.hypot(dx, dy);
}
