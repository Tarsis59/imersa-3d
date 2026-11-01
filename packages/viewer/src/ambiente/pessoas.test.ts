import { describe, expect, it } from 'vitest';
import { caminhoRetangular, MORADORES_POR_NIVEL, planejarMoradores, posicaoNoCaminho } from './pessoas';

const CALCADA = { minX: -20, maxX: 20, minZ: -10, maxZ: 10 };

describe('moradores na calçada', () => {
  it('a volta é o meio da calçada e fecha', () => {
    const c = caminhoRetangular(CALCADA, 1.5);
    expect(c.comprimento).toBeCloseTo(2 * (37 + 17));
    expect(posicaoNoCaminho(c, 0)).toMatchObject({ x: -18.5, z: 8.5 });
    expect(posicaoNoCaminho(c, c.comprimento)).toMatchObject({ x: -18.5, z: 8.5 }); // deu a volta
    expect(posicaoNoCaminho(c, -1).x).toBeCloseTo(-18.5); // para trás também
  });

  it('anda pelos lados e olha para onde vai', () => {
    const c = caminhoRetangular(CALCADA, 1.5);
    const meio = posicaoNoCaminho(c, 18.5);
    expect(meio.x).toBeCloseTo(0);
    expect(meio.z).toBeCloseTo(8.5);
    expect(meio.rumo).toBeCloseTo(Math.PI / 2); // para +x
    const curva = posicaoNoCaminho(c, 37 + 5);
    expect(curva.x).toBeCloseTo(18.5);
    expect(curva.z).toBeCloseTo(3.5);
    expect(Math.abs(curva.rumo)).toBeCloseTo(Math.PI); // para −z
  });

  it('moradores espalhados, com ritmo de passeio, sempre os mesmos', () => {
    const m = planejarMoradores(16, 108);
    expect(m).toHaveLength(16);
    expect(planejarMoradores(16, 108)).toEqual(m);
    for (const x of m) {
      expect(x.velocidade).toBeGreaterThanOrEqual(0.9);
      expect(x.velocidade).toBeLessThanOrEqual(1.4);
      expect(x.inicio).toBeGreaterThanOrEqual(0);
      expect(x.inicio).toBeLessThan(108);
    }
    expect(new Set(m.map((x) => x.sentido)).size).toBe(2); // uns cruzam com os outros
    expect(MORADORES_POR_NIVEL.baixo).toBe(0); // aparelho fraco: ninguém
  });
});
