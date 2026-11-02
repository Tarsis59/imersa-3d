import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const DB_APP = 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_e2e';
/** Prédios reais da Av. Paulista já baixados: o entorno funciona sem internet e sem usar o Overpass público. */
/**
 * E2E_PRODUCAO=1: site em modo de produção (build otimizado), para medir desempenho como a cliente vai ver.
 * E2E_SEM_BUILD=1 junto: usa o build já feito (máquina com pouca memória: build e testes separados).
 */
const PRODUCAO = process.env.E2E_PRODUCAO === '1';
/**
 * 3D no Chromium sem tela: por padrão desenhado por software (SwiftShader), que roda em qualquer máquina e no CI.
 * E2E_GPU=1 usa a placa de vídeo da máquina (medir desempenho como num aparelho de verdade).
 */
const CHROMIUM_3D = process.env.E2E_GPU === '1' ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
/** Worker de capturas sem GPU: devolve esta esfera (gerada pelo pipeline real: PLY → SOG). */
const SPLAT_SIMULADO = fileURLToPath(new URL('./e2e/fixtures/esfera.sog', import.meta.url));
/**
 * Giro 360° fotorrealista: com IMERSA_BLENDER (executável do Blender 4.2) o worker renderiza de verdade nesta
 * máquina; sem ele, devolve um giro de 8 quadros já renderizado pelo Blender (a casa FZK).
 */
const GIRO_SIMULADO = fileURLToPath(new URL('./e2e/fixtures/giro-fzk.zip', import.meta.url));
const VIDEO_SIMULADO = fileURLToPath(new URL('./e2e/fixtures/video-fzk.mp4', import.meta.url));
const VIDEO_CAPA = fileURLToPath(new URL('./e2e/fixtures/video-fzk-capa.jpg', import.meta.url));
const BLENDER = process.env.IMERSA_BLENDER;
const GIRO: Record<string, string> = BLENDER
  ? { GIRO_RENDERIZADOR: 'python', GIRO_BLENDER: BLENDER, GIRO_QUADROS: '24', GIRO_LARGURA: '640', GIRO_ALTURA: '360', GIRO_AMOSTRAS: '16', VIDEO_SEGUNDOS: '2', VIDEO_FPS: '12', VIDEO_AMOSTRAS: '16', VIDEO_ESCALA: '30' }
  : { GIRO_RENDERIZADOR: 'simulado', GIRO_SIMULADO_ZIP: GIRO_SIMULADO, GIRO_SIMULADO_QUADROS: '8', VIDEO_PROVEDOR: 'simulado', VIDEO_SIMULADO_MP4: VIDEO_SIMULADO, VIDEO_SIMULADO_CAPA: VIDEO_CAPA };
const PREDIOS_PAULISTA = fileURLToPath(new URL('../../exemplos/cidade-real/sao-paulo-paulista-osm.json', import.meta.url));
// relevo da Paulista já baixado: o 3D sai sempre igual (testes visuais) e o CI não depende da AWS
const RELEVO_PAULISTA = fileURLToPath(new URL('../../exemplos/cidade-real/relevo', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    // WebGL por software no Chromium sem tela (para o visualizador 3D)
    { name: 'chromium', testIgnore: /tablets\.spec\.ts/, use: { launchOptions: { args: CHROMIUM_3D } } },
    // iPad de verdade = motor do Safari (WebKit), com toque, tela retina e modo móvel
    { name: 'ipad', testMatch: /tablets\.spec\.ts/, use: { ...devices['iPad Pro 11'] } },
    { name: 'tablet-android', testMatch: /tablets\.spec\.ts/, use: { ...devices['Galaxy Tab S4'], launchOptions: { args: CHROMIUM_3D } } },
  ],
  globalSetup: './e2e/preparar.ts',
  webServer: [
    {
      command: 'pnpm --filter @imersa/api start',
      url: 'http://localhost:3334/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL: DB_APP, PORT: '3334', WEB_URL: 'http://localhost:3100', CORS_ORIGIN: 'http://localhost:3100', RATE_LIMIT_AUTH: '1000', API_URL_PUBLICA: 'http://localhost:3334', ARMAZENAMENTO_PASTA: 'armazenamento-e2e', MAPA_ARQUIVO_PREDIOS: PREDIOS_PAULISTA, MAPA_PASTA_RELEVO: RELEVO_PAULISTA, WEBHOOK_PERMITIR_LOCAL: 'true', IA_SIMULADA: 'true' },
    },
    {
      command: 'pnpm --filter @imersa/api worker',
      url: 'http://localhost:3335',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL: DB_APP, ARMAZENAMENTO_PASTA: 'armazenamento-e2e', API_URL_PUBLICA: 'http://localhost:3334', RECONSTRUTOR: 'simulado', RECONSTRUTOR_SPLAT_SIMULADO: SPLAT_SIMULADO, WORKER_PORTA: '3335', WORKER_INTERVALO_S: '2', WORKER_PASTA: 'trabalho-worker-e2e', WEBHOOK_PERMITIR_LOCAL: 'true', ...GIRO },
    },
    {
      command: PRODUCAO ? `${process.env.E2E_SEM_BUILD === '1' ? '' : 'pnpm build && '}pnpm exec next start -p 3100` : 'node scripts/decodificadores.mjs && pnpm exec next dev -p 3100',
      url: 'http://localhost:3100/login',
      reuseExistingServer: false,
      timeout: PRODUCAO ? 600_000 : 180_000,
      env: { API_URL: 'http://localhost:3334', SITE_URL: 'http://localhost:3100' },
    },
  ],
});
