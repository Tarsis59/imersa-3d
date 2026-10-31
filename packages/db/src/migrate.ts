import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const PASTA = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Trava do banco: com várias instâncias da API subindo juntas, só uma aplica as migrations por vez. */
const TRAVA_MIGRATIONS = 4_927_331;

/** Aplica, em ordem e cada uma numa transação, as migrations ainda não aplicadas. Retorna as aplicadas. */
export async function migrate(urlOwner: string): Promise<string[]> {
  const c = new pg.Client({ connectionString: urlOwner });
  await c.connect();
  const aplicadas: string[] = [];
  try {
    await c.query('SELECT pg_advisory_lock($1)', [TRAVA_MIGRATIONS]);
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (nome text PRIMARY KEY, aplicado_em timestamptz NOT NULL DEFAULT now())');
    const feitas = new Set((await c.query<{ nome: string }>('SELECT nome FROM schema_migrations')).rows.map((r) => r.nome));
    const arquivos = (await readdir(PASTA)).filter((f) => f.endsWith('.sql')).sort();
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue;
      const sql = await readFile(resolve(PASTA, arquivo), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
        await c.query('COMMIT');
        aplicadas.push(arquivo);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Migration ${arquivo} falhou: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock($1)', [TRAVA_MIGRATIONS]).catch(() => {});
    await c.end();
  }
  return aplicadas;
}
