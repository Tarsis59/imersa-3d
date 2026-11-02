/**
 * UTM (SIRGAS 2000, o sistema dos levantamentos topográficos no Brasil) → latitude/longitude. SIRGAS 2000 usa o
 * elipsoide GRS80, que coincide com o WGS84 em menos de 1 mm. Fusos do Brasil: 18 a 25; hemisfério sul (o norte
 * do Amapá e de Roraima, acima do Equador, passa `sul = false`).
 */
const A = 6_378_137;
const F = 1 / 298.257222101;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);

export function utmParaLatLon(x: number, y: number, fuso: number, sul = true): { lat: number; lon: number } {
  const lon0 = ((fuso - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const m = (sul ? y - 10_000_000 : y) / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const fi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const n1 = A / Math.sqrt(1 - E2 * Math.sin(fi1) ** 2);
  const t1 = Math.tan(fi1) ** 2;
  const c1 = EP2 * Math.cos(fi1) ** 2;
  const r1 = (A * (1 - E2)) / (1 - E2 * Math.sin(fi1) ** 2) ** 1.5;
  const d = (x - 500_000) / (n1 * K0);
  const lat =
    fi1 -
    ((n1 * Math.tan(fi1)) / r1) *
      (d ** 2 / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * EP2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * EP2 - 3 * c1 ** 2) * d ** 6) / 720);
  const lon = lon0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * EP2 + 24 * t1 ** 2) * d ** 5) / 120) / Math.cos(fi1);
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}
