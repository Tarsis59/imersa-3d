import { describe, it, expect } from 'vitest';
import { massaDoPredio, ALTURA_ANDAR_M } from './massa';
import type { Caixa } from './tipos';

const sobrepoe = (a: Caixa, b: Caixa) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY && a.minZ < b.maxZ && b.minZ < a.maxZ;

describe('massaDoPredio', () => {
  const andares = [
    { numero: 2, unidades: ['201', '202', '203'] },
    { numero: 1, unidades: ['101', '102', '103', '104', '105'] },
  ];
  const m = massaDoPredio(andares);

  it('uma caixa por unidade', () => {
    expect([...m.keys()].sort()).toEqual(['101', '102', '103', '104', '105', '201', '202', '203']);
  });

  it('sem sobreposição', () => {
    const cx = [...m.values()];
    for (let i = 0; i < cx.length; i++) for (let j = i + 1; j < cx.length; j++) expect(sobrepoe(cx[i]!, cx[j]!)).toBe(false);
  });

  it('cada unidade dentro da faixa do seu andar (térreo = 0 no chão), andares em ordem', () => {
    // andar 1 é o mais baixo da lista → começa no chão
    expect(m.get('101')!.minY).toBeGreaterThanOrEqual(0);
    expect(m.get('101')!.maxY).toBeLessThanOrEqual(ALTURA_ANDAR_M);
    expect(m.get('201')!.minY).toBeGreaterThanOrEqual(ALTURA_ANDAR_M);
    expect(m.get('201')!.maxY).toBeLessThanOrEqual(2 * ALTURA_ANDAR_M);
  });

  it('térreo e subsolo: o andar 0 fica no chão e o −1 abaixo dele', () => {
    const s = massaDoPredio([
      { numero: 0, unidades: ['T1'] },
      { numero: -1, unidades: ['S1'] },
    ]);
    expect(s.get('T1')!.minY).toBeGreaterThanOrEqual(0);
    expect(s.get('S1')!.maxY).toBeLessThanOrEqual(0);
  });

  it('prédio centralizado em x/z e folga entre unidades', () => {
    const cx = [...m.values()];
    const minX = Math.min(...cx.map((c) => c.minX));
    const maxX = Math.max(...cx.map((c) => c.maxX));
    expect(minX + maxX).toBeCloseTo(0, 6);
    expect(m.get('101')!.maxX).toBeLessThan(m.get('102')!.minX);
  });

  it('andar vazio não quebra', () => {
    expect(massaDoPredio([{ numero: 1, unidades: [] }]).size).toBe(0);
  });
});
