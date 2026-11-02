import { describe, it, expect } from 'vitest';
import { limitesZoom, distanciaDoZoom, zoomDaDistancia } from './zoom';

const PREDIO = { minX: -10, maxX: 10, minY: 0, maxY: 30, minZ: -10, maxZ: 10 };

describe('zoom vertical da órbita (Plano 12b, item 3)', () => {
  it('t = 1 (bem perto) dá uma distância menor que t = 0 (bem afastado)', () => {
    const limites = limitesZoom(PREDIO);
    expect(distanciaDoZoom(1, limites)).toBeCloseTo(limites.minimo);
    expect(distanciaDoZoom(0, limites)).toBeCloseTo(limites.maximo);
    expect(distanciaDoZoom(1, limites)).toBeLessThan(distanciaDoZoom(0, limites));
  });

  it('é monótono: zoom maior nunca afasta a câmera', () => {
    const limites = limitesZoom(PREDIO);
    const d1 = distanciaDoZoom(0.3, limites);
    const d2 = distanciaDoZoom(0.7, limites);
    expect(d2).toBeLessThan(d1);
  });

  it('é o inverso de zoomDaDistancia (ida e volta)', () => {
    const limites = limitesZoom(PREDIO);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const distancia = distanciaDoZoom(t, limites);
      expect(zoomDaDistancia(distancia, limites)).toBeCloseTo(t, 5);
    }
  });

  it('fica dentro de 0..1 mesmo fora da faixa (roda do mouse livre)', () => {
    const limites = limitesZoom(PREDIO);
    expect(zoomDaDistancia(limites.maximo * 10, limites)).toBe(0);
    expect(zoomDaDistancia(0, limites)).toBe(1);
  });

  it('a faixa cresce com o tamanho do prédio', () => {
    const pequeno = limitesZoom(PREDIO);
    const grande = limitesZoom({ minX: -50, maxX: 50, minY: 0, maxY: 150, minZ: -50, maxZ: 50 });
    expect(grande.maximo).toBeGreaterThan(pequeno.maximo);
  });
});
