import { describe, it, expect } from 'vitest';
import { corDoIndice, indiceDaCor, quadroPorArrasto, poseNoGiro, MAX_UNIDADES_GIRO } from './giro';

describe('cor-ID (máscara de unidades)', () => {
  it('ida e volta exata, inclusive nos extremos', () => {
    for (const i of [0, 1, 254, 255, 256, 65_535, 65_536, 1_000_000, MAX_UNIDADES_GIRO - 1]) {
      const [r, g, b] = corDoIndice(i);
      expect([r, g, b].every((c) => Number.isInteger(c) && c >= 0 && c <= 255)).toBe(true);
      expect(indiceDaCor(r, g, b)).toBe(i);
    }
  });

  it('preto é "nenhuma unidade" (fundo, cidade, chão)', () => {
    expect(indiceDaCor(0, 0, 0)).toBeNull();
    expect(corDoIndice(0)).not.toEqual([0, 0, 0]);
  });

  it('cabem mais de 16 milhões de unidades; fora disso é erro', () => {
    expect(MAX_UNIDADES_GIRO).toBe(256 ** 3 - 1);
    expect(() => corDoIndice(MAX_UNIDADES_GIRO)).toThrow();
    expect(() => corDoIndice(-1)).toThrow();
  });
});

describe('giro: quadros e arrasto', () => {
  it('arrastar a largura inteira dá uma volta completa; volta ao início dos dois lados', () => {
    expect(quadroPorArrasto(0, 1000, 1000, 72)).toBe(0);
    expect(quadroPorArrasto(0, 500, 1000, 72)).toBe(36);
    expect(quadroPorArrasto(0, -1000 / 72, 1000, 72)).toBe(71);
    expect(quadroPorArrasto(70, 3 * (1000 / 72), 1000, 72)).toBe(1);
  });

  it('pose: câmera em círculo em volta do centro, mesma altura, olhando para o centro', () => {
    const centro = { x: 10, y: 20, z: -5 };
    const p0 = poseNoGiro(0, 72, centro, 100, 30, 0);
    const p18 = poseNoGiro(18, 72, centro, 100, 30, 0);
    const horizontal = (p: typeof p0) => Math.hypot(p.posicao.x - centro.x, p.posicao.z - centro.z);
    expect(horizontal(p0)).toBeCloseTo(100 * Math.cos(Math.PI / 6), 6);
    expect(p0.posicao.y).toBeCloseTo(p18.posicao.y, 6);
    expect(p0.posicao.y - centro.y).toBeCloseTo(100 * Math.sin(Math.PI / 6), 6);
    expect(p0.alvo).toEqual(centro);
    // 18 de 72 quadros = um quarto de volta
    const a0 = Math.atan2(p0.posicao.x - centro.x, p0.posicao.z - centro.z);
    const a18 = Math.atan2(p18.posicao.x - centro.x, p18.posicao.z - centro.z);
    expect(Math.abs(Math.abs(a18 - a0) - Math.PI / 2)).toBeLessThan(1e-6);
  });
});
