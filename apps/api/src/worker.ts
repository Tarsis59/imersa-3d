// Worker em processo próprio: `pnpm --filter @imersa/api worker`. Pode haver vários (as filas não repetem).
// `--uma-vez`: processa as capturas e os giros 360° da fila até esvaziar e sai (execução agendada no GitHub Actions).
import { createServer } from 'node:http';
import pg from 'pg';
import { lerConfig } from './config';
import { ConfigWorker, iniciarWorker, processarFila } from './worker/laco';

const extra = ConfigWorker.parse(process.env);
const config = lerConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 3 });

if (process.argv.includes('--uma-vez')) {
  const n = await processarFila(pool, config, extra);
  console.info(`[worker] fila vazia: ${n} trabalho(s) processado(s)`);
  await pool.end();
  process.exit(0);
}

const worker = iniciarWorker(pool, config, extra);

if (extra.WORKER_PORTA) createServer((_req, res) => res.writeHead(worker.ativo ? 200 : 503).end(worker.ativo ? 'ok' : 'parando')).listen(extra.WORKER_PORTA);
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    void worker
      .parar()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
