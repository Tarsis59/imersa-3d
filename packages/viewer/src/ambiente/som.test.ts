import { describe, expect, it } from 'vitest';
import { cantoDePassaro, volumeDaRua } from './som';

describe('som ambiente', () => {
  it('a rua é forte no chão e fraca lá do alto (sem sumir)', () => {
    expect(volumeDaRua(1.6)).toBeGreaterThan(volumeDaRua(60));
    expect(volumeDaRua(60)).toBeGreaterThan(volumeDaRua(300));
    expect(volumeDaRua(300)).toBeCloseTo(0.15 * 0.22);
    expect(volumeDaRua(0)).toBeCloseTo(0.22);
  });

  it('canto de passarinho: 2 a 5 notas curtas e agudas', () => {
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 50; i++) {
      const canto = cantoDePassaro(rnd);
      expect(canto.length).toBeGreaterThanOrEqual(2);
      expect(canto.length).toBeLessThanOrEqual(5);
      for (const n of canto) {
        expect(n.de).toBeGreaterThan(2000);
        expect(n.duracaoS).toBeLessThan(0.14);
        expect(n.ate).not.toBe(n.de); // trinado: a nota desliza
      }
    }
  });
});
