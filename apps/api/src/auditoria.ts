import type pg from 'pg';

export interface Evento {
  userId: string | null;
  acao: string;
  entidade: string;
  entidadeId?: string;
  antes?: unknown;
  depois?: unknown;
}

/** Usa o tenant do contexto da transação (default app_tenant_id() + RLS WITH CHECK). */
export async function registrarAuditoria(c: pg.PoolClient, e: Evento): Promise<void> {
  const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
  await c.query(
    'INSERT INTO audit_logs (user_id, acao, entidade, entidade_id, antes, depois) VALUES ($1, $2, $3, $4, $5, $6)',
    [e.userId, e.acao, e.entidade, e.entidadeId ?? null, json(e.antes), json(e.depois)],
  );
}
