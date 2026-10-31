// API + worker no MESMO processo: para hospedagem grátis com um serviço só (Render, Koyeb).
// Com mais recursos, prefira processos separados (server.ts + worker.ts): um não atrasa o outro.
import * as Sentry from '@sentry/node';
import pg from 'pg';
import { lerConfig } from './config';
import { construirApp } from './app';
import { ConfigWorker, iniciarWorker } from './worker/laco';

const config = lerConfig();
const extra = ConfigWorker.parse(process.env);
if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.AMBIENTE, tracesSampleRate: 0 });

const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 8 });
const poolWorker = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
const app = await construirApp({
  pool,
  config,
  logger: true,
  reportarErro: config.SENTRY_DSN ? (erro, requestId) => Sentry.captureException(erro, { tags: { requestId } }) : undefined,
});
await app.listen({ port: config.PORT, host: '0.0.0.0' });
const worker = iniciarWorker(poolWorker, config, extra);

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    void Promise.all([app.close(), worker.parar()])
      .then(() => Promise.all([pool.end(), poolWorker.end()]))
      .then(() => Sentry.flush(2000))
      .then(() => process.exit(0));
  });
}
