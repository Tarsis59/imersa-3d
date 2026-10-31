import type pg from 'pg';

export interface Contexto {
  tenantId: string | null;
  userId: string | null;
}

/**
 * Executa `fn` numa transação com o contexto da requisição.
 * `set_config(..., true)` = SET LOCAL: vale só até o COMMIT/ROLLBACK, então não vaza para a próxima
 * requisição que reutilizar a mesma conexão do pool.
 */
export async function withTenant<T>(pool: pg.Pool, ctx: Contexto, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [ctx.tenantId ?? '', ctx.userId ?? '']);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
