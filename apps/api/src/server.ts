import * as Sentry from '@sentry/node';
import pg from 'pg';
import { lerConfig } from './config';
import { construirApp } from './app';

const config = lerConfig();
if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.AMBIENTE, tracesSampleRate: 0 });

const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
const app = await construirApp({
  pool,
  config,
  logger: true,
  reportarErro: config.SENTRY_DSN ? (erro, requestId) => Sentry.captureException(erro, { tags: { requestId } }) : undefined,
});
await app.listen({ port: config.PORT, host: '0.0.0.0' });

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => Sentry.flush(2000))
      .then(() => process.exit(0));
  });
}
