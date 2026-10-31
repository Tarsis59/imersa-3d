import { defineConfig } from '@playwright/test';

const DB_APP = 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  globalSetup: './e2e/preparar.ts',
  webServer: [
    {
      command: 'pnpm --filter @imersa/api start',
      url: 'http://localhost:3334/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL: DB_APP, PORT: '3334', WEB_URL: 'http://localhost:3100', CORS_ORIGIN: 'http://localhost:3100', RATE_LIMIT_AUTH: '1000' },
    },
    {
      command: 'pnpm exec next dev -p 3100',
      url: 'http://localhost:3100/login',
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_URL: 'http://localhost:3334' },
    },
  ],
});
