import { createHmac, timingSafeEqual } from 'node:crypto';

export type Operacao = 'put' | 'get';

const mensagem = (op: Operacao, assetId: string, tenantId: string, exp: number) => `arquivo:${op}:${assetId}:${tenantId}:${exp}`;

/** HMAC-SHA256 do link local: vale só para aquela operação, arquivo, empresa e prazo. */
export const assinar = (segredo: string, op: Operacao, assetId: string, tenantId: string, exp: number): string =>
  createHmac('sha256', segredo).update(mensagem(op, assetId, tenantId, exp)).digest('base64url');

export function conferirAssinatura(
  segredo: string,
  op: Operacao,
  assetId: string,
  tenantId: string,
  exp: number,
  assinatura: string,
  agoraS = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isInteger(exp) || exp < agoraS) return false;
  const esperado = Buffer.from(assinar(segredo, op, assetId, tenantId, exp));
  const recebido = Buffer.from(assinatura);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
