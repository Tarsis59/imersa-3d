import { describe, it, expect } from 'vitest';
import { entornoParaLocal, type PredioEntorno } from './entorno';

const CENTRO = { lat: -23.56175, lon: -46.6545 };
const M_LON = 1 / (111_320 * Math.cos((CENTRO.lat * Math.PI) / 180));
const M_LAT = 1 / 110_540;
/** Quadrado de 10 m com o canto sudoeste a (leste, norte) metros do centro. */
const quadrado = (id: number, leste: number, norte: number, alturaM = 30): PredioEntorno => ({
  osmId: `way/${id}`,
  alturaM,
  contorno: [
    [CENTRO.lon + leste * M_LON, CENTRO.lat + norte * M_LAT],
    [CENTRO.lon + (leste + 10) * M_LON, CENTRO.lat + norte * M_LAT],
    [CENTRO.lon + (leste + 10) * M_LON, CENTRO.lat + (norte + 10) * M_LAT],
    [CENTRO.lon + leste * M_LON, CENTRO.lat + (norte + 10) * M_LAT],
  ],
});

describe('entorno em coordenadas locais', () => {
  it('sem rotação: leste = +x, norte = −z; altura e id preservados', () => {
    const [p] = entornoParaLocal([quadrado(5, 100, 0, 45)], CENTRO, 0, null);
    expect(p!.id).toBe(5);
    expect(p!.height).toBe(45);
    expect(p!.footprint[0]!.x).toBeCloseTo(100, 1);
    expect(p!.footprint[0]!.z).toBeCloseTo(0, 1);
    expect(p!.footprint[2]!.z).toBeCloseTo(-10, 1);
  });

  it('projeto girado 90° (frente para o leste): o leste do mundo fica na frente do modelo (−z)', () => {
    const [p] = entornoParaLocal([quadrado(1, 100, 0)], CENTRO, 90, null);
    expect(p!.footprint[0]!.x).toBeCloseTo(0, 1);
    expect(p!.footprint[0]!.z).toBeCloseTo(-100, 1);
  });

  it('tira do entorno o que ocupa o lote do empreendimento (com folga)', () => {
    const lote = { minX: -12, maxX: 12, minY: 0, maxY: 60, minZ: -12, maxZ: 12 };
    const r = entornoParaLocal([quadrado(1, -5, -5), quadrado(2, 14, 0), quadrado(3, 40, 40)], CENTRO, 0, lote, 3);
    expect(r.map((p) => p.id)).toEqual([3]);
  });

  it('ignora contornos inválidos e ids estranhos', () => {
    const ruim = { osmId: 'way/9', alturaM: 10, contorno: [[0, 0], [1, 1]] as Array<[number, number]> };
    const semId = { ...quadrado(1, 50, 50), osmId: 'relation/x' };
    expect(entornoParaLocal([ruim, semId], CENTRO, 0, null)).toEqual([]);
  });
});
