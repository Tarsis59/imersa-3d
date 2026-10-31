import { describe, it, expect } from 'vitest';
import { assinar, conferirAssinatura } from './assinatura';

const S = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const agora = 1_800_000_000;

describe('links assinados', () => {
  const sig = assinar(S, 'put', 'arquivo-1', 'empresa-1', agora + 60);

  it('confere dentro da validade', () => {
    expect(conferirAssinatura(S, 'put', 'arquivo-1', 'empresa-1', agora + 60, sig, agora)).toBe(true);
  });
  it('expirado não vale', () => {
    expect(conferirAssinatura(S, 'put', 'arquivo-1', 'empresa-1', agora + 60, sig, agora + 61)).toBe(false);
  });
  it('não serve para outra operação, outro arquivo, outra empresa ou outro prazo', () => {
    expect(conferirAssinatura(S, 'get', 'arquivo-1', 'empresa-1', agora + 60, sig, agora)).toBe(false);
    expect(conferirAssinatura(S, 'put', 'arquivo-2', 'empresa-1', agora + 60, sig, agora)).toBe(false);
    expect(conferirAssinatura(S, 'put', 'arquivo-1', 'empresa-2', agora + 60, sig, agora)).toBe(false);
    expect(conferirAssinatura(S, 'put', 'arquivo-1', 'empresa-1', agora + 600, sig, agora)).toBe(false);
  });
  it('assinatura vazia, alterada ou prazo inválido não vale', () => {
    expect(conferirAssinatura(S, 'put', 'arquivo-1', 'empresa-1', agora + 60, '', agora)).toBe(false);
    expect(conferirAssinatura(S, 'put', 'arquivo-1', 'empresa-1', agora + 60, `${sig}x`, agora)).toBe(false);
    expect(conferirAssinatura(S, 'put', 'arquivo-1', 'empresa-1', Number.NaN, sig, agora)).toBe(false);
  });
});
