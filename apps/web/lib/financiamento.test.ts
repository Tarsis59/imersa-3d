import { describe, it, expect } from 'vitest';
import { simular, taxaMensal } from './financiamento';

// 1% ao mês equivale a 12,6825% ao ano efetivo
const UM_POR_CENTO_AO_MES = (Math.pow(1.01, 12) - 1) * 100;

describe('simulação de financiamento', () => {
  it('taxa anual efetiva → mensal equivalente', () => {
    expect(taxaMensal(UM_POR_CENTO_AO_MES)).toBeCloseTo(0.01, 10);
    expect(taxaMensal(0)).toBe(0);
  });

  it('Price: parcela constante de referência (100 mil, 1% a.m., 12 meses = R$ 8.884,88)', () => {
    const r = simular({ preco: 100_000, entrada: 0, fgts: 0, prazoMeses: 12, taxaAnual: UM_POR_CENTO_AO_MES })!;
    expect(r.price.parcela).toBeCloseTo(8884.88, 2);
    expect(r.price.totalPago).toBeCloseTo(8884.88 * 12, 0);
  });

  it('SAC: 1ª e última parcelas e juros totais de referência', () => {
    const r = simular({ preco: 100_000, entrada: 0, fgts: 0, prazoMeses: 12, taxaAnual: UM_POR_CENTO_AO_MES })!;
    expect(r.sac.primeira).toBeCloseTo(9333.33, 2);
    expect(r.sac.ultima).toBeCloseTo(8416.67, 2);
    expect(r.sac.juros).toBeCloseTo(6500, 2); // 1% × 8.333,33 × (12+11+…+1)
    expect(r.sac.juros).toBeLessThan(r.price.juros); // SAC paga menos juros que Price
  });

  it('entrada e FGTS abatem do financiado; renda sugerida com a 1ª parcela em 30%', () => {
    const r = simular({ preco: 600_000, entrada: 100_000, fgts: 20_000, prazoMeses: 360, taxaAnual: 11.5 })!;
    expect(r.financiado).toBe(480_000);
    expect(r.rendaSugerida).toBeCloseTo(r.sac.primeira / 0.3, 1);
    expect(r.sac.primeira).toBeGreaterThan(r.price.parcela); // SAC começa maior
  });

  it('taxa zero divide em partes iguais', () => {
    const r = simular({ preco: 1200, entrada: 0, fgts: 0, prazoMeses: 12, taxaAnual: 0 })!;
    expect(r.price.parcela).toBe(100);
    expect(r.sac.primeira).toBe(100);
  });

  it('dados impossíveis não simulam', () => {
    const ok = { preco: 500_000, entrada: 100_000, fgts: 0, prazoMeses: 360, taxaAnual: 11 };
    expect(simular({ ...ok, entrada: 500_000 })).toBeNull(); // nada a financiar
    expect(simular({ ...ok, prazoMeses: 0 })).toBeNull();
    expect(simular({ ...ok, prazoMeses: 421 })).toBeNull();
    expect(simular({ ...ok, preco: 0 })).toBeNull();
    expect(simular({ ...ok, taxaAnual: -1 })).toBeNull();
  });
});
