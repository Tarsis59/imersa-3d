import { defineConfig } from '@playwright/test';

// Teste no ar (produção de verdade): SITE_PRODUCAO e API_PRODUCAO. Sem servidores locais.
// Uso: pnpm --filter @imersa/web exec playwright test -c e2e-producao
export default defineConfig({
  testDir: '.',
  timeout: 900_000,
  // API (Virgínia) ↔ banco (São Paulo): cada ação leva alguns segundos a mais que no teste local
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.SITE_PRODUCAO ?? 'https://imersa-3d.vercel.app',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});
