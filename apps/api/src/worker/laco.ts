import { setTimeout as esperar } from 'node:timers/promises';
import { resolve } from 'node:path';
import type pg from 'pg';
import { z } from 'zod';
import { armazenamentoDaConfig } from '../app';
import type { Config } from '../config';
import { processarProxima, reconstrutorPython, reconstrutorSimulado } from '../capturas/worker';
import { anonimizarEventos, periodica } from '../vendas/retencao';
import { entregarWebhooks } from '../integracoes/entregas';
import { conversorPython, processarProximaConversao } from '../bim/worker';
import { leitorPython, processarProximaPlanta } from '../plantas/worker';

export const ConfigWorker = z.object({
  RECONSTRUTOR: z.enum(['python', 'simulado']).default('python'),
  RECONSTRUTOR_SPLAT_SIMULADO: z.string().optional(),
  RECONSTRUCAO_PYTHON: z.string().optional(),
  RECONSTRUCAO_DIR: z.string().default(resolve(import.meta.dirname, '../../../../servicos/reconstrucao')),
  KAGGLE_USERNAME: z.string().optional(),
  WORKER_PORTA: z.coerce.number().int().positive().optional(),
  WORKER_INTERVALO_S: z.coerce.number().positive().default(15),
  WORKER_PASTA: z.string().default('trabalho-worker'),
  /** Prazo de retenção do IP/navegador das visitas ao portal (LGPD). */
  RETENCAO_EVENTOS_DIAS: z.coerce.number().int().min(1).max(3650).default(180),
  /**
   * `false`: este processo não pega capturas (só webhooks e retenção). Usado na hospedagem grátis que desliga
   * sem visitas (Render): lá uma captura de 1 h morreria no meio; quem processa é o GitHub Actions (`--uma-vez`).
   */
  /** Conversão IFC → 3D (rápida: segundos a poucos minutos; roda junto da API mesmo na hospedagem grátis). */
  WORKER_BIM: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  BIM_DIR: z.string().default(resolve(import.meta.dirname, '../../../../servicos/bim')),
  BIM_PYTHON: z.string().optional(),
  WORKER_CAPTURAS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});
export type ConfigWorker = z.infer<typeof ConfigWorker>;

/**
 * Laço do worker: capturas (fotos/vídeo → 3D), webhooks para CRMs e retenção LGPD.
 * Usado pelo processo próprio (`worker.ts`) e pelo modo "tudo num serviço" (`tudo.ts`, hospedagem grátis).
 */
function montarDeps(pool: pg.Pool, config: Config, extra: ConfigWorker) {
  const pythonPadrao = resolve(extra.RECONSTRUCAO_DIR, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (extra.RECONSTRUTOR === 'python' && !extra.KAGGLE_USERNAME) throw new Error('Defina KAGGLE_USERNAME (usuário do Kaggle que roda a GPU)');
  if (extra.RECONSTRUTOR === 'simulado' && !extra.RECONSTRUTOR_SPLAT_SIMULADO) throw new Error('Defina RECONSTRUTOR_SPLAT_SIMULADO');
  const reconstrutor =
    extra.RECONSTRUTOR === 'simulado'
      ? reconstrutorSimulado(extra.RECONSTRUTOR_SPLAT_SIMULADO!)
      : reconstrutorPython({ python: extra.RECONSTRUCAO_PYTHON ?? pythonPadrao, diretorio: extra.RECONSTRUCAO_DIR, usuarioKaggle: extra.KAGGLE_USERNAME! });
  return { pool, armazenamento: armazenamentoDaConfig(config), reconstrutor, pastaTrabalho: resolve(extra.WORKER_PASTA) };
}

/** Processa as capturas da fila até ela esvaziar e devolve quantas processou (execução agendada, ex.: GitHub Actions). */
export async function processarFila(pool: pg.Pool, config: Config, extra: ConfigWorker): Promise<number> {
  const deps = montarDeps(pool, config, extra);
  let n = 0;
  for (;;) {
    const r = await processarProxima(deps);
    if (r === 'vazia') return n;
    n++;
    console.info(`[worker] captura processada: ${r}`);
  }
}

function montarBim(pool: pg.Pool, config: Config, extra: ConfigWorker) {
  const python = extra.BIM_PYTHON ?? resolve(extra.BIM_DIR, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  return { pool, armazenamento: armazenamentoDaConfig(config), conversor: conversorPython({ python, diretorio: extra.BIM_DIR }), pastaTrabalho: resolve(extra.WORKER_PASTA) };
}

/** Leitor de plantas: mesmo ambiente Python do BIM (servicos/bim/imersa_planta). */
function montarPlantas(pool: pg.Pool, config: Config, extra: ConfigWorker) {
  const python = extra.BIM_PYTHON ?? resolve(extra.BIM_DIR, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  return { pool, armazenamento: armazenamentoDaConfig(config), leitor: leitorPython({ python, diretorio: extra.BIM_DIR }), pastaTrabalho: resolve(extra.WORKER_PASTA) };
}

export function iniciarWorker(pool: pg.Pool, config: Config, extra: ConfigWorker) {
  const deps = extra.WORKER_CAPTURAS ? montarDeps(pool, config, extra) : null;
  const bim = extra.WORKER_BIM ? montarBim(pool, config, extra) : null;
  const plantas = extra.WORKER_BIM ? montarPlantas(pool, config, extra) : null;
  const retencao = periodica(6 * 3600 * 1000, async () => {
    try {
      const n = await anonimizarEventos(pool, extra.RETENCAO_EVENTOS_DIAS);
      if (n) console.info(`[worker] retenção: ${n} eventos de visita anonimizados (mais de ${extra.RETENCAO_EVENTOS_DIAS} dias)`);
    } catch (e) {
      console.error('[worker] retenção falhou (tenta de novo na próxima volta)', e);
      throw e;
    }
  });

  let ativo = true;
  const parado = (async () => {
    console.info(extra.WORKER_CAPTURAS ? `[worker] capturas: reconstrutor ${extra.RECONSTRUTOR}` : '[worker] capturas desligadas aqui (só webhooks e retenção)');
    while (ativo) {
      try {
        await retencao();
        const webhooks = await entregarWebhooks(pool, config.TOTP_KEY, { permitirLocal: config.WEBHOOK_PERMITIR_LOCAL }).catch((e) => {
          console.error('[worker] webhooks: erro inesperado', e);
          return 0;
        });
        if (webhooks) console.info(`[worker] webhooks: ${webhooks} entrega(s) tentada(s)`);
        const conversao = bim ? await processarProximaConversao(bim) : 'vazia';
        if (conversao !== 'vazia') console.info(`[worker] conversão BIM: ${conversao}`);
        const planta = plantas ? await processarProximaPlanta(plantas) : 'vazia';
        if (planta !== 'vazia') console.info(`[worker] leitura de planta: ${planta}`);
        const r = deps ? await processarProxima(deps) : 'vazia';
        if (r !== 'vazia') console.info(`[worker] captura processada: ${r}`);
        if (r === 'vazia' && conversao === 'vazia' && planta === 'vazia' && ativo) await esperar(extra.WORKER_INTERVALO_S * 1000);
      } catch (e) {
        console.error('[worker] erro inesperado', e);
        if (ativo) await esperar(extra.WORKER_INTERVALO_S * 1000);
      }
    }
  })();

  return {
    get ativo() {
      return ativo;
    },
    /** Termina a volta atual (uma captura em andamento continua até acabar) e para. */
    parar: async () => {
      ativo = false;
      await parado;
    },
  };
}
