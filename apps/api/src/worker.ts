// Worker de capturas (fotos/vídeo → 3D): `pnpm --filter @imersa/api worker`. Pode haver vários (a fila não repete).
import { createServer } from 'node:http';
import { setTimeout as esperar } from 'node:timers/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { z } from 'zod';
import { armazenamentoDaConfig } from './app';
import { lerConfig } from './config';
import { processarProxima, reconstrutorPython, reconstrutorSimulado } from './capturas/worker';

const extra = z
  .object({
    RECONSTRUTOR: z.enum(['python', 'simulado']).default('python'),
    RECONSTRUTOR_SPLAT_SIMULADO: z.string().optional(),
    RECONSTRUCAO_PYTHON: z.string().optional(),
    RECONSTRUCAO_DIR: z.string().default(resolve(import.meta.dirname, '../../../servicos/reconstrucao')),
    KAGGLE_USERNAME: z.string().optional(),
    WORKER_PORTA: z.coerce.number().int().positive().optional(),
    WORKER_INTERVALO_S: z.coerce.number().positive().default(15),
    WORKER_PASTA: z.string().default('trabalho-worker'),
  })
  .parse(process.env);

const config = lerConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 3 });
const pythonPadrao = resolve(extra.RECONSTRUCAO_DIR, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
if (extra.RECONSTRUTOR === 'python' && !extra.KAGGLE_USERNAME) throw new Error('Defina KAGGLE_USERNAME (usuário do Kaggle que roda a GPU)');
if (extra.RECONSTRUTOR === 'simulado' && !extra.RECONSTRUTOR_SPLAT_SIMULADO) throw new Error('Defina RECONSTRUTOR_SPLAT_SIMULADO');
const reconstrutor =
  extra.RECONSTRUTOR === 'simulado'
    ? reconstrutorSimulado(extra.RECONSTRUTOR_SPLAT_SIMULADO!)
    : reconstrutorPython({ python: extra.RECONSTRUCAO_PYTHON ?? pythonPadrao, diretorio: extra.RECONSTRUCAO_DIR, usuarioKaggle: extra.KAGGLE_USERNAME! });
const deps = { pool, armazenamento: armazenamentoDaConfig(config), reconstrutor, pastaTrabalho: resolve(extra.WORKER_PASTA) };

let ativo = true;
if (extra.WORKER_PORTA) createServer((_req, res) => res.writeHead(ativo ? 200 : 503).end(ativo ? 'ok' : 'parando')).listen(extra.WORKER_PORTA);
for (const sinal of ['SIGINT', 'SIGTERM'] as const) process.on(sinal, () => (ativo = false));

console.info(`[worker] capturas: reconstrutor ${extra.RECONSTRUTOR}`);
while (ativo) {
  try {
    const r = await processarProxima(deps);
    if (r !== 'vazia') console.info(`[worker] captura processada: ${r}`);
    if (r === 'vazia') await esperar(extra.WORKER_INTERVALO_S * 1000);
  } catch (e) {
    console.error('[worker] erro inesperado', e);
    await esperar(extra.WORKER_INTERVALO_S * 1000);
  }
}
await pool.end();
process.exit(0);
