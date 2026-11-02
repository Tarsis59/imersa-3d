import { describe, it, expect } from 'vitest';
import { ATMOSFERA, brilhoDasEstrelas, corDoHorizonte } from './ceu';

describe('céu', () => {
  it('horizonte: azul de dia, alaranjado no pôr do sol, escuro à noite', () => {
    const dia = corDoHorizonte(0.8, 'limpo');
    const tarde = corDoHorizonte(0.05, 'limpo');
    const noite = corDoHorizonte(-0.3, 'limpo');
    expect(dia.b).toBeGreaterThan(dia.r); // azulado
    expect(tarde.r).toBeGreaterThan(tarde.b); // alaranjado
    expect(noite.r + noite.g + noite.b).toBeLessThan(0.3);
  });

  it('a transição é contínua (sem salto de cor ao mover a hora)', () => {
    for (let e = -0.2; e < 0.5; e += 0.01) {
      const a = corDoHorizonte(e, 'limpo');
      const b = corDoHorizonte(e + 0.01, 'limpo');
      expect(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)).toBeLessThan(0.25);
    }
  });

  it('nublado: mais nuvens e horizonte acinzentado', () => {
    expect(ATMOSFERA.nublado.cobertura).toBeGreaterThan(ATMOSFERA.limpo.cobertura);
    const c = corDoHorizonte(0.8, 'nublado');
    expect(Math.abs(c.r - c.b)).toBeLessThan(0.08);
  });

  it('estrelas só com o sol abaixo do horizonte', () => {
    expect(brilhoDasEstrelas(0.5)).toBe(0);
    expect(brilhoDasEstrelas(0)).toBe(0);
    expect(brilhoDasEstrelas(-0.1)).toBeGreaterThan(0);
    expect(brilhoDasEstrelas(-0.5)).toBe(1);
  });
});
