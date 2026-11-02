import { describe, expect, it } from 'vitest';
import { orientacaoDoLote } from './orientacao';

// Retângulo de 40 m (leste-oeste) × 20 m (norte-sul), com o primeiro ponto na origem (lat 0, sem distorção da
// projeção): os lados sul e norte (40 m) são os mais longos; o sul vem primeiro no desenho.
const DLON_40M = 40 / 111_320;
const DLAT_20M = 20 / 110_540;
const RETANGULO: Array<[number, number]> = [
  [0, 0],
  [DLON_40M, 0],
  [DLON_40M, DLAT_20M],
  [0, DLAT_20M],
];

describe('orientação do lote (Plano 12d, item 6)', () => {
  it('sem via por perto: cai para o maior lado do polígono (aqui, o lado sul, o primeiro dos dois lados de 40 m)', () => {
    const o = orientacaoDoLote(RETANGULO);
    expect(o).toMatchObject({ anguloGraus: 180, rotulo: 'Sul' });
    expect(o!.dica).toMatch(/pouco sol/);
  });

  it('com uma rua a norte: o lado da frente passa a ser o lado voltado para ela, mesmo do mesmo tamanho do lado sul', () => {
    const viaAoNorte: Array<[number, number]> = [
      [-50 / 111_320, DLAT_20M + 5 / 110_540],
      [100 / 111_320, DLAT_20M + 5 / 110_540],
    ];
    const o = orientacaoDoLote(RETANGULO, [viaAoNorte]);
    expect(o).toMatchObject({ anguloGraus: 0, rotulo: 'Norte' });
    expect(o!.dica).toMatch(/sol o dia todo/);
  });

  it('com uma rua a leste: o lado leste (mais curto, 20 m) vira a frente', () => {
    const viaALeste: Array<[number, number]> = [
      [DLON_40M + 5 / 111_320, -10 / 110_540],
      [DLON_40M + 5 / 111_320, 50 / 110_540],
    ];
    const o = orientacaoDoLote(RETANGULO, [viaALeste]);
    expect(o).toMatchObject({ rotulo: 'Leste' });
    expect(o!.dica).toMatch(/sol da manhã/);
  });

  it('hemisfério norte: a dica do sol se inverte (fachada sul é a mais procurada)', () => {
    const o = orientacaoDoLote(RETANGULO, [], false);
    expect(o).toMatchObject({ rotulo: 'Sul' });
    expect(o!.dica).toMatch(/sol o dia todo/);
  });

  it('polígono inválido (menos de 3 pontos) devolve null', () => {
    expect(orientacaoDoLote([[0, 0], [1, 1]])).toBeNull();
  });
});
