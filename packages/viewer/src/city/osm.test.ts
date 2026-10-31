import { describe, it, expect } from 'vitest';
import { osmToBuildings, parseHeight, removeNear, type OsmData } from './osm';

const O = { lon: 0, lat: 0 };

const dados: OsmData = {
  elements: [
    { type: 'node', id: 1, lon: 0, lat: 0 },
    { type: 'node', id: 2, lon: 0.0001, lat: 0 },
    { type: 'node', id: 3, lon: 0.0001, lat: 0.0001 },
    { type: 'node', id: 4, lon: 0, lat: 0.0001 },
    { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes', height: '30 m', name: 'Ed. Teste' } },
    { type: 'way', id: 11, nodes: [1, 2, 3, 1], tags: { building: 'yes', 'building:levels': '10' } },
    { type: 'way', id: 12, nodes: [1, 2, 99, 1], tags: { building: 'yes' } },
    { type: 'way', id: 13, nodes: [1, 2, 3, 1], tags: { highway: 'residential' } },
    { type: 'way', id: 14, nodes: [1, 2, 1], tags: { building: 'yes' } },
  ],
};

describe('parseHeight', () => {
  it('usa height (aceita "30 m")', () => expect(parseHeight({ height: '30 m' })).toBe(30));
  it('usa andares × 3 m', () => expect(parseHeight({ 'building:levels': '10' })).toBe(30));
  it('padrão 9 m', () => expect(parseHeight({})).toBe(9));
  it('ignora valores inválidos', () => expect(parseHeight({ height: 'alto', 'building:levels': '-2' })).toBe(9));
});

describe('osmToBuildings', () => {
  const b = osmToBuildings(dados, O);

  it('só aceita ways de prédio, completos e com ≥ 3 pontos', () => {
    expect(b.map((x) => x.id)).toEqual([10, 11]);
  });

  it('remove o ponto repetido de fechamento', () => {
    expect(b[0]!.footprint).toHaveLength(4);
    expect(b[1]!.footprint).toHaveLength(3);
  });

  it('carrega altura e nome', () => {
    expect(b[0]!.height).toBe(30);
    expect(b[0]!.name).toBe('Ed. Teste');
    expect(b[1]!.height).toBe(30);
  });
});

describe('removeNear', () => {
  it('remove prédios com centro dentro do raio', () => {
    const b = osmToBuildings(dados, O);
    expect(removeNear(b, { x: 0, z: 0 }, 50)).toHaveLength(0);
    expect(removeNear(b, { x: 1000, z: 0 }, 50)).toHaveLength(2);
  });
});
