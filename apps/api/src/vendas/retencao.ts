import type pg from 'pg';

/**
 * `fn` roda na 1ª chamada e depois no máximo uma vez por intervalo. Falhou? Tenta de novo na próxima chamada.
 * Devolve se rodou com sucesso.
 */
export function periodica(intervaloMs: number, fn: (agora: number) => Promise<unknown>) {
  let ultima: number | null = null;
  return async (agora = Date.now()): Promise<boolean> => {
    if (ultima !== null && agora - ultima < intervaloMs) return false;
    try {
      await fn(agora);
      ultima = agora;
      return true;
    } catch {
      return false;
    }
  };
}

/** LGPD: eventos de visita mais velhos que `dias` perdem IP, navegador e sessão (os números continuam). */
export const anonimizarEventos = async (pool: pg.Pool, dias: number): Promise<number> =>
  (await pool.query<{ n: number }>('SELECT anonimizar_eventos($1) AS n', [dias])).rows[0]!.n;
