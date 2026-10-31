import { describe, it, expect } from 'vitest';
import { lonLatToLocal, ORIGEM_PAULISTA } from './project';

describe('lonLatToLocal', () => {
  it('a origem vira (0, 0)', () => {
    const p = lonLatToLocal(ORIGEM_PAULISTA, ORIGEM_PAULISTA);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it('0,001° ao norte fica ~110,5 m em -z', () => {
    const p = lonLatToLocal({ lon: ORIGEM_PAULISTA.lon, lat: ORIGEM_PAULISTA.lat + 0.001 }, ORIGEM_PAULISTA);
    expect(p.z).toBeCloseTo(-110.54, 1);
    expect(p.x).toBeCloseTo(0, 6);
  });

  it('0,001° a leste fica ~102 m em +x na latitude de São Paulo', () => {
    const p = lonLatToLocal({ lon: ORIGEM_PAULISTA.lon + 0.001, lat: ORIGEM_PAULISTA.lat }, ORIGEM_PAULISTA);
    const esperado = 111.32 * Math.cos((ORIGEM_PAULISTA.lat * Math.PI) / 180);
    expect(p.x).toBeCloseTo(esperado, 2);
    expect(p.x).toBeGreaterThan(101);
    expect(p.x).toBeLessThan(103);
  });
});
