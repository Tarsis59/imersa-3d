import { describe, it, expect } from 'vitest';
import { ALTURA_PAREDE_BAIXA_M, paredesDoContorno, usarParedesDoModelo } from './casaDeBonecas';

const caixa = (largura: number, profundidade: number, alturaUnidade: number, pisoY = 0) => ({
  minX: 0,
  maxX: largura,
  minY: pisoY,
  maxY: pisoY + alturaUnidade,
  minZ: 0,
  maxZ: profundidade,
});

describe('paredes geradas do contorno (casa de bonecas)', () => {
  it('unidade mais alta que a parede baixa: 4 paredes baixas (opacas) + 4 faixas translúcidas até o topo', () => {
    const paredes = paredesDoContorno(caixa(6, 4, 3.0));
    const opacas = paredes.filter((p) => !p.translucida);
    const translucidas = paredes.filter((p) => p.translucida);
    expect(opacas).toHaveLength(4);
    expect(translucidas).toHaveLength(4);
    for (const p of opacas) {
      expect(p.caixa.minY).toBe(0);
      expect(p.caixa.maxY).toBeCloseTo(ALTURA_PAREDE_BAIXA_M);
    }
    for (const p of translucidas) {
      expect(p.caixa.minY).toBeCloseTo(ALTURA_PAREDE_BAIXA_M);
      expect(p.caixa.maxY).toBeCloseTo(3.0);
    }
  });

  it('unidade mais baixa que a parede baixa (pé-direito curto): só as 4 paredes, até o topo, sem faixa translúcida', () => {
    const paredes = paredesDoContorno(caixa(6, 4, 2.2));
    expect(paredes).toHaveLength(4);
    for (const p of paredes) {
      expect(p.translucida).toBe(false);
      expect(p.caixa.maxY).toBeCloseTo(2.2);
    }
  });

  it('acompanha o piso do andar (minY da caixa), não sempre 0', () => {
    const paredes = paredesDoContorno(caixa(6, 4, 3.0, 12.5));
    for (const p of paredes.filter((p) => !p.translucida)) {
      expect(p.caixa.minY).toBeCloseTo(12.5);
      expect(p.caixa.maxY).toBeCloseTo(12.5 + ALTURA_PAREDE_BAIXA_M);
    }
  });

  it('paredes ficam dentro do contorno da unidade (sem passar da caixa) e os cantos não se repetem', () => {
    const c = caixa(6, 4, 3.0);
    const paredes = paredesDoContorno(c);
    for (const p of paredes) {
      expect(p.caixa.minX).toBeGreaterThanOrEqual(c.minX - 1e-9);
      expect(p.caixa.maxX).toBeLessThanOrEqual(c.maxX + 1e-9);
      expect(p.caixa.minZ).toBeGreaterThanOrEqual(c.minZ - 1e-9);
      expect(p.caixa.maxZ).toBeLessThanOrEqual(c.maxZ + 1e-9);
    }
    // parede da frente e do fundo cobrem a largura inteira; as laterais (finas) ficam só entre as duas (sem sobrepor o canto)
    const frente = paredes.find((p) => !p.translucida && p.caixa.minZ === c.minZ)!;
    const lateral = paredes.find((p) => !p.translucida && p.caixa.maxX - p.caixa.minX < 1)!;
    expect(frente.caixa.maxX - frente.caixa.minX).toBeCloseTo(c.maxX - c.minX);
    expect(lateral.caixa.minZ).toBeGreaterThan(c.minZ);
    expect(lateral.caixa.maxZ).toBeLessThan(c.maxZ);
  });
});

describe('escolha da fonte das paredes (modelo BIM × contorno gerado)', () => {
  it('prédio com modelo (sólidos do GLB): usa as paredes reais', () => {
    expect(usarParedesDoModelo(true)).toBe(true);
  });
  it('prédio desenhado (sem sólidos): cai no contorno gerado', () => {
    expect(usarParedesDoModelo(false)).toBe(false);
  });
});
