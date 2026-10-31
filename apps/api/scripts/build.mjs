// Empacota a API (e o executor de migrations) num único arquivo cada. Ficam de fora só os módulos nativos/instrumentados.
import { build } from 'esbuild';

const banner = { js: "import { createRequire as __criarRequire } from 'node:module'; const require = __criarRequire(import.meta.url);" };
const entradas = [
  ['src/server.ts', 'dist/server.mjs'],
  ['../../packages/db/src/migrate-cli.ts', 'dist/migrate.mjs'],
];

for (const [entrada, saida] of entradas) {
  await build({
    entryPoints: [entrada],
    outfile: saida,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    external: ['@node-rs/argon2', '@sentry/node', 'pg-native'],
    banner,
    logLevel: 'info',
  });
}
