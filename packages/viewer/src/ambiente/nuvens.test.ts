import { describe, expect, it } from 'vitest';
import { ALTURA_NUVENS_M, FAIXA_FADE_M, NUVENS_POR_NIVEL, opacidadeNuvem } from './nuvens';

describe('nuvens baixas', () => {
  it('esmaece perto da câmera, para ela atravessar sem ver uma borda dura', () => {
    expect(opacidadeNuvem(ALTURA_NUVENS_M)).toBe(0); // bem na altura da nuvem: invisível
    expect(opacidadeNuvem(ALTURA_NUVENS_M - FAIXA_FADE_M)).toBe(1); // na faixa normal de ver: opaca
    expect(opacidadeNuvem(ALTURA_NUVENS_M - FAIXA_FADE_M / 2)).toBeCloseTo(0.5);
    expect(opacidadeNuvem(0)).toBe(1); // bem longe, embaixo: opaca
  });

  it('desligada no aparelho fraco; ligada do médio para cima', () => {
    expect(NUVENS_POR_NIVEL.baixo).toBe(false);
    expect(NUVENS_POR_NIVEL.medio).toBe(true);
    expect(NUVENS_POR_NIVEL.alto).toBe(true);
  });
});
