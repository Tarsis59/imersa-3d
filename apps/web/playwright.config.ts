import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const DB_APP = 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_e2e';
/** Prédios reais da Av. Paulista já baixados: o entorno funciona sem internet e sem usar o Overpass público. */
/** E2E_PRODUCAO=1: site em modo de produção (build otimizado), para medir desempenho como a cliente vai ver. */
const PRODUCAO = process.env.E2E_PRODUCAO === '1';
const PREDIOS_PAULISTA = fileURLToPath(new URL('../../../exemplos/cidade-real/sao-paulo-paulista-osm.json', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    // WebGL por software no Chromium sem tela (para o visualizador 3D)
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  globalSetup: './e2e/preparar.ts',
  webServer: [
    {
      command: 'pnpm --filter @imersa/api start',
      url: 'http://localhost:3334/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL: DB_APP, PORT: '3334', WEB_URL: 'http://localhost:3100', CORS_ORIGIN: 'http://localhost:3100', RATE_LIMIT_AUTH: '1000', API_URL_PUBLICA: 'http://localhost:3334', ARMAZENAMENTO_PASTA: 'armazenamento-e2e', MAPA_ARQUIVO_PREDIOS: PREDIOS_PAULISTA },
    },
    {
      command: PRODUCAO ? 'pnpm build && pnpm exec next start -p 3100' : 'node scripts/decodificadores.mjs && pnpm exec next dev -p 3100',
      url: 'http://localhost:3100/login',
      reuseExistingServer: false,
      timeout: PRODUCAO ? 600_000 : 180_000,
      env: { API_URL: 'http://localhost:3334' },
    },
  ],
});
