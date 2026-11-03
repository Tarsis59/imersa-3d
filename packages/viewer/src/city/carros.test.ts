import { describe, expect, it } from 'vitest';
import { CARROS_POR_NIVEL, intensidadeFarol, pistasDeVias, planejarCarros, posicaoNaPista, type PistaCarro } from './carros';

describe('pistas das ruas', () => {
  it('tira a calçada de pedestre e os trechos curtos demais', () => {
    const vias = [
      { tipo: 'local' as const, largura: 7, pontos: [{ x: 0, z: 0 }, { x: 100, z: 0 }] },
      { tipo: 'pedestre' as const, largura: 2.5, pontos: [{ x: 0, z: 10 }, { x: 100, z: 10 }] },
      { tipo: 'servico' as const, largura: 4, pontos: [{ x: 0, z: 20 }, { x: 10, z: 20 }] }, // 10 m: curto demais
    ];
    const p = pistasDeVias(vias);
    expect(p).toHaveLength(1);
    expect(p[0]!.tipo).toBe('local');
    expect(p[0]!.comprimento).toBe(100);
  });
});

describe('carros nas pistas', () => {
  it('espalhados proporcionalmente ao comprimento, sempre os mesmos', () => {
    const pistas = pistasDeVias([
      { tipo: 'principal', largura: 14, pontos: [{ x: 0, z: 0 }, { x: 300, z: 0 }] },
      { tipo: 'local', largura: 7, pontos: [{ x: 0, z: 50 }, { x: 40, z: 50 }] },
    ]);
    const c = planejarCarros(pistas, 10);
    expect(c).toHaveLength(10);
    expect(planejarCarros(pistas, 10)).toEqual(c);
    // a avenida (300 m) ganha bem mais carros que a rua curta (40 m)
    expect(c.filter((x) => x.pista === 0).length).toBeGreaterThan(c.filter((x) => x.pista === 1).length);
    for (const x of c) expect(x.velocidade).toBeGreaterThan(0);
  });

  it('sem pistas ou sem pedido, nenhum carro', () => {
    expect(planejarCarros([], 10)).toEqual([]);
    const pistas = pistasDeVias([{ tipo: 'local', largura: 7, pontos: [{ x: 0, z: 0 }, { x: 100, z: 0 }] }]);
    expect(planejarCarros(pistas, 0)).toEqual([]);
  });

  it('nenhum carro no aparelho fraco', () => {
    expect(CARROS_POR_NIVEL.baixo).toBe(0);
    expect(CARROS_POR_NIVEL.medio).toBeGreaterThan(0);
    expect(CARROS_POR_NIVEL.alto).toBeGreaterThan(CARROS_POR_NIVEL.medio);
  });
});

describe('o carro segue a via', () => {
  const pista: PistaCarro = { tipo: 'local', largura: 8, pontos: [{ x: 0, z: 0 }, { x: 100, z: 0 }], acumulado: [0, 100], comprimento: 100 };

  it('anda sobre o eixo da rua (desviado pela mão direita) e olha para onde vai', () => {
    const inicio = posicaoNaPista(pista, 0);
    expect(inicio.x).toBeCloseTo(0, 5);
    expect(Math.abs(inicio.z)).toBeGreaterThan(0.5); // já desviado da mão direita desde o início
    const meio = posicaoNaPista(pista, 50);
    expect(meio.x).toBeCloseTo(50, 5);
    expect(meio.rumo).toBeCloseTo(Math.PI / 2); // para +x
    expect(Math.abs(meio.z)).toBeGreaterThan(0.5); // fora do eixo: não anda bem no meio da pista
  });

  it('mão direita: ida e volta ficam em lados opostos do eixo, sem se cruzar', () => {
    const ida = posicaoNaPista(pista, 50); // dentro do 1º trecho (indo)
    const volta = posicaoNaPista(pista, 150); // 2× comprimento − 50: já voltando
    expect(volta.x).toBeCloseTo(ida.x, 5); // mesmo ponto da rua
    expect(Math.sign(volta.z)).toBe(-Math.sign(ida.z)); // lado oposto do eixo
    expect(volta.rumo).toBeCloseTo(-Math.PI / 2); // olhando para o lado contrário (ida ia para +x)
  });

  it('pista sem pontos suficientes não quebra', () => {
    const vazia: PistaCarro = { tipo: 'local', largura: 8, pontos: [{ x: 5, z: 9 }], acumulado: [0], comprimento: 0 };
    expect(posicaoNaPista(vazia, 30)).toEqual({ x: 5, z: 9, rumo: 0 });
  });
});

describe('faróis e lanternas', () => {
  it('só à noite', () => {
    expect(intensidadeFarol(0)).toBe(0);
    expect(intensidadeFarol(1)).toBeGreaterThan(0);
    expect(intensidadeFarol(0.5)).toBeGreaterThan(intensidadeFarol(0));
  });
});
