import { describe, it, expect } from 'vitest';
import { gerarUnidades, statusPara, COR_STATUS, resumo } from './tower';

describe('gerarUnidades', () => {
  const u = gerarUnidades({ andares: 20, unidadesPorAndar: 4, alturaAndarM: 3, larguraM: 24 });

  it('cria andares × unidades', () => expect(u).toHaveLength(80));

  it('códigos no padrão brasileiro (andar + final)', () => {
    expect(u[0]!.codigo).toBe('101');
    expect(u[79]!.codigo).toBe('2004');
  });

  it('cada unidade ocupa um quadrante do andar, na altura certa', () => {
    const a5 = u.filter((x) => x.andar === 5);
    expect(a5).toHaveLength(4);
    for (const x of a5) {
      expect(x.caixa.minY).toBeCloseTo(12, 6);
      expect(x.caixa.maxY).toBeCloseTo(15, 6);
      expect(x.caixa.maxX - x.caixa.minX).toBeCloseTo(12, 6);
    }
  });

  it('status determinístico (mesmo resultado sempre)', () => {
    expect(statusPara(3, 2)).toBe(statusPara(3, 2));
  });

  it('resumo soma o total', () => {
    const r = resumo(u);
    expect(r.disponivel + r.reservado + r.vendido).toBe(80);
    expect(r.disponivel).toBeGreaterThan(0);
    expect(r.vendido).toBeGreaterThan(0);
  });

  it('cores definidas para todos os status', () => {
    expect(Object.keys(COR_STATUS).sort()).toEqual(['disponivel', 'reservado', 'vendido']);
  });
});
