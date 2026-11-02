import { describe, expect, it } from 'vitest';
import { caminhoRetangular, estaParado, MORADORES_POR_NIVEL, planejarMoradores, posicaoNoCaminho, tempoAndado, type Parada } from './pessoas';

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

  it('cada pessoa tem seu próprio ciclo de parada (não sincronizado)', () => {
    const m = planejarMoradores(16, 108);
    expect(new Set(m.map((x) => x.parada.faseS)).size).toBeGreaterThan(8);
    for (const x of m) {
      expect(x.parada.duracaoS).toBeGreaterThan(0);
      expect(x.parada.duracaoS).toBeLessThan(x.parada.cicloS);
    }
  });
});

describe('parada ocasional (Plano 12a, item 9)', () => {
  const PARADA: Parada = { cicloS: 20, duracaoS: 4, faseS: 0 };

  it('anda normalmente antes da parada', () => {
    expect(tempoAndado(0, PARADA)).toBe(0);
    expect(tempoAndado(10, PARADA)).toBe(10);
    expect(estaParado(0, PARADA)).toBe(false);
    expect(estaParado(10, PARADA)).toBe(false);
  });

  it('para no fim do trecho andado e fica parado até o ciclo fechar', () => {
    expect(estaParado(16, PARADA)).toBe(true);
    expect(estaParado(19.9, PARADA)).toBe(true);
    expect(tempoAndado(16, PARADA)).toBeCloseTo(16);
    expect(tempoAndado(18, PARADA)).toBeCloseTo(16); // parado: não avança
    expect(tempoAndado(19.9, PARADA)).toBeCloseTo(16);
  });

  it('continua de onde tinha parado, sem salto nem recuo', () => {
    const antes = tempoAndado(19.99, PARADA);
    const depois = tempoAndado(20.01, PARADA);
    expect(depois).toBeGreaterThan(antes - 1e-6);
    expect(depois).toBeCloseTo(16.01);
    expect(estaParado(20.01, PARADA)).toBe(false);
  });

  it('a fase (`faseS`) espalha as paradas: cada pessoa para numa hora diferente', () => {
    const a: Parada = { cicloS: 20, duracaoS: 4, faseS: 0 };
    const b: Parada = { cicloS: 20, duracaoS: 4, faseS: 10 };
    expect(estaParado(16, a)).toBe(true);
    expect(estaParado(16, b)).toBe(false);
    expect(estaParado(6, b)).toBe(true);
  });

  it('duração inválida (0 ou maior que o ciclo): nunca para, anda sempre', () => {
    expect(estaParado(100, { cicloS: 20, duracaoS: 0, faseS: 0 })).toBe(false);
    expect(tempoAndado(100, { cicloS: 20, duracaoS: 0, faseS: 0 })).toBe(100);
    expect(estaParado(100, { cicloS: 20, duracaoS: 30, faseS: 0 })).toBe(false);
  });
});
