import { defineConfig } from 'vitest/config';

export default defineConfig({
  // até 4 arquivos ao mesmo tempo: cada um recria o próprio banco, e 8 juntos esgotam a tabela de travas do Postgres
  test: { environment: 'node', testTimeout: 30_000, hookTimeout: 60_000, maxWorkers: 4 },
});
