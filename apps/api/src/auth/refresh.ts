import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ErroHttp } from '../erros';

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Guarda só o hash do refresh; o token em si só existe com o cliente. */
export async function criarRefresh(c: pg.PoolClient, userId: string, tenantId: string, familia: string = randomUUID()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await c.query(
    "INSERT INTO refresh_tokens (user_id, tenant_id, familia, token_hash, expira_em) VALUES ($1, $2, $3, $4, now() + interval '30 days')",
    [userId, tenantId, familia, hashToken(token)],
  );
  return token;
}

/**
 * Rotação: cada refresh vale uma vez. Se um refresh já usado aparecer de novo (roubo provável),
 * a família inteira é revogada e o usuário precisa entrar de novo.
 */
export async function girarRefresh(pool: pg.Pool, token: string): Promise<{ userId: string; tenantId: string; novo: string }> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query<{ id: string; user_id: string; tenant_id: string; familia: string; usado_em: Date | null; revogado_em: Date | null; expirado: boolean }>(
      'SELECT id, user_id, tenant_id, familia, usado_em, revogado_em, expira_em < now() AS expirado FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
      [hashToken(token)],
    );
    const t = r.rows[0];
    if (!t || t.revogado_em || t.expirado) throw new ErroHttp(401, 'refresh_invalido');
    if (t.usado_em) {
      await c.query('UPDATE refresh_tokens SET revogado_em = now() WHERE familia = $1 AND revogado_em IS NULL', [t.familia]);
      await c.query('COMMIT');
      throw new ErroHttp(401, 'refresh_reutilizado');
    }
    await c.query('UPDATE refresh_tokens SET usado_em = now() WHERE id = $1', [t.id]);
    const novo = await criarRefresh(c, t.user_id, t.tenant_id, t.familia);
    await c.query('COMMIT');
    return { userId: t.user_id, tenantId: t.tenant_id, novo };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
