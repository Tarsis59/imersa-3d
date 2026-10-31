// Gera um único SQL (preparar.sql + todas as migrations, registradas em schema_migrations) para colar no
// SQL Editor do Supabase quando não der para rodar `pnpm db:migrate` (ex.: senha do banco ainda não definida).
// Uso: node infra/supabase/gerar-esquema.mjs > esquema-supabase.sql
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const pasta = resolve(aqui, '../../packages/db/migrations');
const partes = [readFileSync(resolve(aqui, 'preparar.sql'), 'utf8'), 'CREATE TABLE IF NOT EXISTS schema_migrations (nome text PRIMARY KEY, aplicado_em timestamptz NOT NULL DEFAULT now());'];
for (const nome of readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort()) {
  partes.push(`-- ==================== ${nome}`, readFileSync(resolve(pasta, nome), 'utf8'), `INSERT INTO schema_migrations (nome) VALUES ('${nome}');`);
}
// tudo numa transação: ou entra inteiro, ou nada muda
process.stdout.write(['BEGIN;', ...partes, 'COMMIT;', ''].join('\n'));
