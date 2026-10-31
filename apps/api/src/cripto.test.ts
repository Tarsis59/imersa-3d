import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { cifrar, decifrar } from './cripto';

const CHAVE = randomBytes(32).toString('base64url');

describe('cifra AES-256-GCM', () => {
  it('ida e volta', () => expect(decifrar(cifrar('JBSWY3DPEHPK3PXP', CHAVE), CHAVE)).toBe('JBSWY3DPEHPK3PXP'));
  it('mesmo texto gera cifras diferentes (IV aleatório)', () => expect(cifrar('a', CHAVE)).not.toBe(cifrar('a', CHAVE)));
  it('chave errada falha', () => {
    expect(() => decifrar(cifrar('segredo', CHAVE), randomBytes(32).toString('base64url'))).toThrow();
  });
  it('cifra adulterada falha', () => {
    const [v, iv, tag, dados] = cifrar('segredo', CHAVE).split('.');
    const mexido = Buffer.from(dados!, 'base64url');
    mexido[0] = mexido[0]! ^ 1;
    expect(() => decifrar([v, iv, tag, mexido.toString('base64url')].join('.'), CHAVE)).toThrow();
  });
  it('formato inválido falha', () => expect(() => decifrar('texto-puro', CHAVE)).toThrow(/formato/));
});
