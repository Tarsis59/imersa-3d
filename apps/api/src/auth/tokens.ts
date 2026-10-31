import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { PAPEIS, type Papel } from './rbac';

export interface Sessao {
  userId: string;
  tenantId: string;
  papel: Papel;
  /** true só quando o login passou pelo código TOTP. */
  mfa: boolean;
}

const EMISSOR = 'imersa';
const PUBLICO = 'imersa-api';
const chave = (segredo: string) => new TextEncoder().encode(segredo);
const Carga = z.object({ sub: z.uuid(), tid: z.uuid(), papel: z.enum(PAPEIS), mfa: z.boolean() });

/** Token de acesso curto (padrão 15 min). */
export async function emitirAcesso(s: Sessao, segredo: string, validadeS = 900): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  return new SignJWT({ tid: s.tenantId, papel: s.papel, mfa: s.mfa })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.userId)
    .setIssuer(EMISSOR)
    .setAudience(PUBLICO)
    .setIssuedAt(agora)
    .setExpirationTime(agora + validadeS)
    .sign(chave(segredo));
}

export async function verificarAcesso(token: string, segredo: string): Promise<Sessao> {
  const { payload } = await jwtVerify(token, chave(segredo), { issuer: EMISSOR, audience: PUBLICO, algorithms: ['HS256'] });
  const c = Carga.parse(payload);
  return { userId: c.sub, tenantId: c.tid, papel: c.papel, mfa: c.mfa };
}
