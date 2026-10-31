import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { emitirAcesso, verificarAcesso, type Sessao } from './tokens';

const S = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const sessao: Sessao = { userId: randomUUID(), tenantId: randomUUID(), papel: 'admin', mfa: false };

describe('token de acesso', () => {
  it('ida e volta (com e sem MFA)', async () => {
    expect(await verificarAcesso(await emitirAcesso(sessao, S), S)).toEqual(sessao);
    const comMfa = { ...sessao, mfa: true };
    expect(await verificarAcesso(await emitirAcesso(comMfa, S), S)).toEqual(comMfa);
  });
  it('segredo errado é rejeitado', async () => {
    await expect(verificarAcesso(await emitirAcesso(sessao, S), S + 'x')).rejects.toThrow();
  });
  it('token expirado é rejeitado', async () => {
    await expect(verificarAcesso(await emitirAcesso(sessao, S, -10), S)).rejects.toThrow();
  });
  it('token adulterado (forjar mfa:true) é rejeitado', async () => {
    const [h, , a] = (await emitirAcesso(sessao, S)).split('.');
    const carga = Buffer.from(JSON.stringify({ sub: sessao.userId, tid: sessao.tenantId, papel: 'admin', mfa: true })).toString('base64url');
    await expect(verificarAcesso(`${h}.${carga}.${a}`, S)).rejects.toThrow();
  });
});
