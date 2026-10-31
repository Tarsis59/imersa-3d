import { describe, it, expect } from 'vitest';
import { periodica } from './retencao';

describe('tarefa periódica (retenção LGPD dos eventos)', () => {
  it('roda na 1ª chamada e depois só a cada intervalo; erro não derruba e tenta de novo na próxima', async () => {
    const chamadas: number[] = [];
    let falhar = false;
    const t = periodica(1000, async (agora) => {
      chamadas.push(agora);
      if (falhar) throw new Error('banco fora');
    });
    expect(await t(0)).toBe(true);
    expect(await t(999)).toBe(false);
    expect(await t(1000)).toBe(true);
    falhar = true;
    expect(await t(2500)).toBe(false);
    falhar = false;
    expect(await t(2501)).toBe(true);
    expect(chamadas).toEqual([0, 1000, 2500, 2501]);
  });
});
