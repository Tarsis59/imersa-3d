import { describe, it, expect } from 'vitest';
import { hashSenha, conferirSenha } from './senha';

describe('senha (Argon2id)', () => {
  it('gera hash Argon2id e confere', async () => {
    const h = await hashSenha('senha-forte-123');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await conferirSenha(h, 'senha-forte-123')).toBe(true);
    expect(await conferirSenha(h, 'senha-errada-123')).toBe(false);
  });

  it('mesma senha gera hashes diferentes (salt)', async () => {
    expect(await hashSenha('igual-igual-1')).not.toBe(await hashSenha('igual-igual-1'));
  });
});
