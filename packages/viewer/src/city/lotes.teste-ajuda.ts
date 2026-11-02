/** Só para testes: ponto do chão local (metros; x leste, z sul) → [lon, lat] perto do centro. */
export function localParaLonLat(centro: { lon: number; lat: number }, x: number, z: number): [number, number] {
  const lat = centro.lat - z / 110_574;
  const lon = centro.lon + x / (111_320 * Math.cos((centro.lat * Math.PI) / 180));
  return [lon, lat];
}
