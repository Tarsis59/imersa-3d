import { describe, expect, it } from 'vitest';
import { ehPorDoSol, MISSOES, progressoTipologias, somarCaminhada } from './missoes';

describe('missões', () => {
  it('cinco missões, com os mesmos nomes do banco', () => {
    expect(MISSOES.map((m) => m.id)).toEqual(['lazer', 'tipologias', 'por_dentro', 'por_do_sol', 'a_pe']);
  });
  it('tipologias: meta de 3 tipos (ou todos, se houver menos); a mesma planta não conta duas vezes', () => {
    const us = [
      { id: 'a', quartos: 2, areaM2: 60 },
      { id: 'b', quartos: 2, areaM2: 60 },
      { id: 'c', quartos: 3, areaM2: 85 },
      { id: 'd', quartos: 4, areaM2: 120 },
      { id: 'e', quartos: 1, areaM2: 40 },
    ];
    expect(progressoTipologias(new Set(['a', 'b']), us)).toEqual({ vistos: 1, meta: 3 });
    expect(progressoTipologias(new Set(['a', 'c', 'd']), us)).toEqual({ vistos: 3, meta: 3 });
    expect(progressoTipologias(new Set(['a']), us.slice(0, 2))).toEqual({ vistos: 1, meta: 1 });
  });
  it('caminhada soma os passos e ignora teleporte', () => {
    let t = 0;
    t = somarCaminhada(t, null, { x: 0, z: 0 });
    t = somarCaminhada(t, { x: 0, z: 0 }, { x: 3, z: 4 });
    t = somarCaminhada(t, { x: 3, z: 4 }, { x: 103, z: 4 });
    expect(t).toBe(5);
  });
  it('pôr do sol só vendo a unidade, das 17h às 19h', () => {
    expect(ehPorDoSol(18, true)).toBe(true);
    expect(ehPorDoSol(18, false)).toBe(false);
    expect(ehPorDoSol(12, true)).toBe(false);
  });
});
