import { describe, it, expect } from 'vitest';
import { base32Codificar, base32Decodificar, codigoTotp, conferirTotp, contadorTotp, gerarSegredoTotp, urlOtpauth } from './totp';

// Vetores oficiais da RFC 6238 (SHA-1): segredo ASCII "12345678901234567890"
const RFC = base32Codificar(Buffer.from('12345678901234567890'));

describe('base32', () => {
  it('codifica o segredo da RFC', () => expect(RFC).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));
  it('ida e volta', () => {
    const b = Buffer.from([0, 1, 2, 250, 255, 7, 99]);
    expect(base32Decodificar(base32Codificar(b)).equals(b)).toBe(true);
  });
  it('rejeita caractere inválido', () => expect(() => base32Decodificar('ABC1')).toThrow());
});

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('T=%i → %s (8 dígitos)', (t, esperado) => expect(codigoTotp(RFC, t * 1000, 8)).toBe(esperado));

  it('6 dígitos = últimos 6 do vetor', () => expect(codigoTotp(RFC, 59_000)).toBe('287082'));

  it('aceita a janela vizinha (±30 s) e recusa fora dela', () => {
    const t = 1_700_000_000_000;
    const c = codigoTotp(RFC, t);
    expect(conferirTotp(RFC, c, t + 30_000)).toBe(true);
    expect(conferirTotp(RFC, c, t + 90_000)).toBe(false);
  });

  it('devolve o contador da janela aceita (para bloquear reuso) ou null', () => {
    const t = 1_700_000_000_000;
    const atual = Math.floor(t / 30_000);
    expect(contadorTotp(RFC, codigoTotp(RFC, t), t)).toBe(atual);
    expect(contadorTotp(RFC, codigoTotp(RFC, t - 30_000), t)).toBe(atual - 1);
    expect(contadorTotp(RFC, codigoTotp(RFC, t + 30_000), t)).toBe(atual + 1);
    expect(contadorTotp(RFC, codigoTotp(RFC, t + 90_000), t)).toBeNull();
  });

  it('gera segredo de 160 bits', () => expect(gerarSegredoTotp()).toMatch(/^[A-Z2-7]{32}$/));

  it('monta a URL do app autenticador', () => {
    expect(urlOtpauth('ABC', 'a@b.com')).toBe(
      'otpauth://totp/Imersa%203D:a%40b.com?secret=ABC&issuer=Imersa%203D&algorithm=SHA1&digits=6&period=30',
    );
  });
});
