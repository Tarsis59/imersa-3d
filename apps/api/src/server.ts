import pg from 'pg';
import { lerConfig } from './config';
import { construirApp } from './app';

const config = lerConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
const app = await construirApp({ pool, config, logger: true });
await app.listen({ port: config.PORT, host: '0.0.0.0' });

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
