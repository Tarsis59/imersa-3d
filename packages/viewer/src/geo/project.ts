export interface LonLat {
  lon: number;
  lat: number;
}

export interface Local {
  /** metros para leste */
  x: number;
  /** metros para sul (norte = -z) */
  z: number;
}

/** Centro da área baixada do OSM (Av. Paulista, São Paulo). */
export const ORIGEM_PAULISTA: LonLat = { lon: -46.6545, lat: -23.56175 };

const METROS_POR_GRAU_LAT = 110_540;
const METROS_POR_GRAU_LON_EQUADOR = 111_320;

/** Projeção equiretangular local. Erro < 0,1% num raio de poucos km — suficiente para um bairro. */
export function lonLatToLocal(p: LonLat, origem: LonLat): Local {
  const cosLat = Math.cos((origem.lat * Math.PI) / 180);
  return {
    x: (p.lon - origem.lon) * METROS_POR_GRAU_LON_EQUADOR * cosLat,
    z: -(p.lat - origem.lat) * METROS_POR_GRAU_LAT,
  };
}
