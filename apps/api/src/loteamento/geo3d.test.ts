import { describe, expect, it } from 'vitest';
import { distanciaLonLatM, modeloParaLonLat } from './geo3d';

describe('ponte geo ↔ eixos do 3D do prédio', () => {
  const centro = { lon: -46.65, lat: -23.56 };

  it('sem giro: x leste vira +lon, z sul vira -lat (mesma convenção do viewer)', () => {
    const p = modeloParaLonLat({ x: 100, z: 0 }, centro, 0);
    expect(p.lon).toBeGreaterThan(centro.lon);
    expect(p.lat).toBeCloseTo(centro.lat, 6);
    const q = modeloParaLonLat({ x: 0, z: 100 }, centro, 0);
    expect(q.lat).toBeLessThan(centro.lat); // z positivo = sul = latitude menor
    expect(q.lon).toBeCloseTo(centro.lon, 6);
  });

  it('a distância até o ponto convertido bate com a distância local em metros (ida e volta)', () => {
    const p = modeloParaLonLat({ x: 30, z: 40 }, centro, 0);
    expect(distanciaLonLatM(centro, p)).toBeCloseTo(50, 0); // 3-4-5
  });

  it('giro de 90°: x leste do modelo vira z sul do chão local (continua 100 m de distância)', () => {
    const p = modeloParaLonLat({ x: 100, z: 0 }, centro, 90);
    expect(distanciaLonLatM(centro, p)).toBeCloseTo(100, 0);
  });

  it('distância é aproximadamente simétrica (projeção local, não exige geodésia exata)', () => {
    const a = { lon: -46.65, lat: -23.56 };
    const b = { lon: -46.649, lat: -23.559 };
    expect(distanciaLonLatM(a, b)).toBeCloseTo(distanciaLonLatM(b, a), 0);
  });
});
