import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Codificar(buf: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO.charAt((valor >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO.charAt((valor << (5 - bits)) & 31);
  return saida;
}

export function base32Decodificar(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/\s/g, '').replace(/=+$/, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const ch of limpo) {
    const i = ALFABETO.indexOf(ch);
    if (i < 0) throw new Error('base32 inválido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const gerarSegredoTotp = (): string => base32Codificar(randomBytes(20));

/** RFC 6238 / RFC 4226 com HMAC-SHA1, passo de 30 s. */
export function codigoTotp(segredo: string, momentoMs = Date.now(), digitos = 6, passoS = 30): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(momentoMs / 1000 / passoS)));
  const h = createHmac('sha1', base32Decodificar(segredo)).update(contador).digest();
  const desloc = h[h.length - 1]! & 0x0f;
  const binario = h.readUInt32BE(desloc) & 0x7fffffff;
  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/** Contador (janela de 30 s) em que o código bate, olhando a atual e as vizinhas (relógio do celular ±30 s); null se não bate. */
export function contadorTotp(segredo: string, codigo: string, momentoMs = Date.now()): number | null {
  const alvo = Buffer.from(codigo);
  const base = Math.floor(momentoMs / 30_000);
  for (const j of [-1, 0, 1]) {
    const c = Buffer.from(codigoTotp(segredo, (base + j) * 30_000));
    if (c.length === alvo.length && timingSafeEqual(c, alvo)) return base + j;
  }
  return null;
}

/** Aceita o código da janela atual e das vizinhas (tolera relógio do celular ±30 s). */
export const conferirTotp = (segredo: string, codigo: string, momentoMs = Date.now()): boolean => contadorTotp(segredo, codigo, momentoMs) !== null;

export function urlOtpauth(segredo: string, conta: string): string {
  const emissor = encodeURIComponent('Imersa 3D');
  return `otpauth://totp/${emissor}:${encodeURIComponent(conta)}?secret=${segredo}&issuer=${emissor}&algorithm=SHA1&digits=6&period=30`;
}
