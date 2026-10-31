import pg from 'pg';
import { migrate } from './migrate';

/** Só para testes: apaga tudo e reaplica as migrations. */
export async function resetarBanco(urlOwner: string): Promise<void> {
  const c = new pg.Client({ connectionString: urlOwner });
  await c.connect();
  try {
    await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  } finally {
    await c.end();
  }
  await migrate(urlOwner);
}
