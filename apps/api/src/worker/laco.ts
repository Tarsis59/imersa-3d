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
import { processarProximoGiro, renderizadorPython, renderizadorSimulado } from '../giros/worker';
import { processarProximoVideo, provedorBlender, provedorSimulado } from '../videos/worker';
import { assadorPython, assadorSimulado, processarProximoBake } from '../bakes/worker';

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
  /** Giro 360° fotorrealista: Blender na GPU do Kaggle ('python'), ou um ZIP pronto (testes e demonstração). */
  GIRO_RENDERIZADOR: z.enum(['python', 'simulado']).default('python'),
  GIRO_SIMULADO_ZIP: z.string().optional(),
  GIRO_SIMULADO_QUADROS: z.coerce.number().int().positive().default(72),
  /** Executável do Blender desta máquina: renderiza aqui em vez de no Kaggle (quem tem placa de vídeo). */
  GIRO_BLENDER: z.string().optional(),
  /** Qualidade do giro (vazio = padrão do serviço: 72 quadros de 1280×720 com 96 amostras). */
  GIRO_QUADROS: z.coerce.number().int().min(8).max(360).optional(),
  GIRO_LARGURA: z.coerce.number().int().min(160).max(3840).optional(),
  GIRO_ALTURA: z.coerce.number().int().min(90).max(2160).optional(),
  GIRO_AMOSTRAS: z.coerce.number().int().min(1).max(4096).optional(),
  /** Vídeos de marketing: Blender (Kaggle, ou o local de GIRO_BLENDER) ou um MP4 pronto (testes). */
  VIDEO_PROVEDOR: z.enum(['blender', 'simulado']).default('blender'),
  VIDEO_SIMULADO_MP4: z.string().optional(),
  VIDEO_SIMULADO_CAPA: z.string().optional(),
  /** Qualidade (vazio = padrão do serviço: 10 s, 30 quadros/s, 48 amostras com redução de ruído, 1080p). */
  VIDEO_SEGUNDOS: z.coerce.number().positive().max(60).optional(),
  VIDEO_FPS: z.coerce.number().int().min(6).max(60).optional(),
  VIDEO_AMOSTRAS: z.coerce.number().int().min(1).max(4096).optional(),
  VIDEO_ESCALA: z.coerce.number().int().min(10).max(100).optional(),
  /** Bake da luz (AO + difusa de dia e de noite): Blender (Kaggle, ou o local de GIRO_BLENDER) ou um GLB pronto (testes). */
  BAKE_ASSADOR: z.enum(['python', 'simulado']).default('python'),
  BAKE_SIMULADO_GLB: z.string().optional(),
  /** Qualidade (vazio = padrão do serviço: textura de 1K). */
  BAKE_LARGURA: z.coerce.number().int().min(256).max(4096).optional(),
  BAKE_AMOSTRAS: z.coerce.number().int().min(1).max(4096).optional(),
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

function montarVideos(pool: pg.Pool, config: Config, extra: ConfigWorker) {
  const pythonPadrao = resolve(extra.RECONSTRUCAO_DIR, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (extra.VIDEO_PROVEDOR === 'simulado' && !extra.VIDEO_SIMULADO_MP4) throw new Error('Defina VIDEO_SIMULADO_MP4');
  const provedor =
    extra.VIDEO_PROVEDOR === 'simulado'
      ? provedorSimulado(extra.VIDEO_SIMULADO_MP4!, extra.VIDEO_SIMULADO_CAPA ?? null)
      : provedorBlender({
          python: extra.RECONSTRUCAO_PYTHON ?? pythonPadrao,
          diretorio: extra.RECONSTRUCAO_DIR,
          usuarioKaggle: extra.KAGGLE_USERNAME,
          blender: extra.GIRO_BLENDER,
          qualidade: { segundos: extra.VIDEO_SEGUNDOS, fps: extra.VIDEO_FPS, amostras: extra.VIDEO_AMOSTRAS, escala: extra.GIRO_BLENDER ? extra.VIDEO_ESCALA : undefined },
        });
  return { pool, armazenamento: armazenamentoDaConfig(config), provedor, pastaTrabalho: resolve(extra.WORKER_PASTA) };
}

/** Giro 360° fotorrealista: mesmo serviço Python (e mesma conta do Kaggle) das capturas; longo como elas. */
function montarGiros(pool: pg.Pool, config: Config, extra: ConfigWorker) {
  const pythonPadrao = resolve(extra.RECONSTRUCAO_DIR, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (extra.GIRO_RENDERIZADOR === 'simulado' && !extra.GIRO_SIMULADO_ZIP) throw new Error('Defina GIRO_SIMULADO_ZIP');
  const renderizador =
    extra.GIRO_RENDERIZADOR === 'simulado'
      ? renderizadorSimulado(extra.GIRO_SIMULADO_ZIP!, extra.GIRO_SIMULADO_QUADROS)
      : renderizadorPython({
          python: extra.RECONSTRUCAO_PYTHON ?? pythonPadrao,
          diretorio: extra.RECONSTRUCAO_DIR,
          usuarioKaggle: extra.KAGGLE_USERNAME,
          blender: extra.GIRO_BLENDER,
          qualidade: { quadros: extra.GIRO_QUADROS, largura: extra.GIRO_LARGURA, altura: extra.GIRO_ALTURA, amostras: extra.GIRO_AMOSTRAS },
        });
  return { pool, armazenamento: armazenamentoDaConfig(config), renderizador, pastaTrabalho: resolve(extra.WORKER_PASTA) };
}

/** Bake da luz: mesmo serviço Python (e mesma conta do Kaggle) dos giros; roda em minutos. */
function montarBakes(pool: pg.Pool, config: Config, extra: ConfigWorker) {
  const pythonPadrao = resolve(extra.RECONSTRUCAO_DIR, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (extra.BAKE_ASSADOR === 'simulado' && !extra.BAKE_SIMULADO_GLB) throw new Error('Defina BAKE_SIMULADO_GLB');
  const assador =
    extra.BAKE_ASSADOR === 'simulado'
      ? assadorSimulado(extra.BAKE_SIMULADO_GLB!)
      : assadorPython({
          python: extra.RECONSTRUCAO_PYTHON ?? pythonPadrao,
          diretorio: extra.RECONSTRUCAO_DIR,
          usuarioKaggle: extra.KAGGLE_USERNAME,
          blender: extra.GIRO_BLENDER,
          qualidade: { largura: extra.BAKE_LARGURA, amostras: extra.BAKE_AMOSTRAS },
        });
  return { pool, armazenamento: armazenamentoDaConfig(config), assador, pastaTrabalho: resolve(extra.WORKER_PASTA) };
}

/**
 * Processa as capturas, giros, vídeos e bakes da fila até ela esvaziar e devolve quantos processou (execução
 * agendada, ex.: GitHub Actions).
 */
export async function processarFila(pool: pg.Pool, config: Config, extra: ConfigWorker): Promise<number> {
  const deps = montarDeps(pool, config, extra);
  const giros = montarGiros(pool, config, extra);
  const videos = montarVideos(pool, config, extra);
  const bakes = montarBakes(pool, config, extra);
  let n = 0;
  for (;;) {
    const r = await processarProxima(deps);
    if (r !== 'vazia') console.info(`[worker] captura processada: ${r}`);
    const g = await processarProximoGiro(giros);
    if (g !== 'vazia') console.info(`[worker] giro 360° renderizado: ${g}`);
    const v = await processarProximoVideo(videos);
    if (v !== 'vazia') console.info(`[worker] vídeo de marketing renderizado: ${v}`);
    const bk = await processarProximoBake(bakes);
    if (bk !== 'vazia') console.info(`[worker] bake da luz assado: ${bk}`);
    if (r === 'vazia' && g === 'vazia' && v === 'vazia' && bk === 'vazia') return n;
    n += Number(r !== 'vazia') + Number(g !== 'vazia') + Number(v !== 'vazia') + Number(bk !== 'vazia');
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
  const giros = extra.WORKER_CAPTURAS ? montarGiros(pool, config, extra) : null;
  const videos = extra.WORKER_CAPTURAS ? montarVideos(pool, config, extra) : null;
  const bakes = extra.WORKER_CAPTURAS ? montarBakes(pool, config, extra) : null;
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
        const giro = giros ? await processarProximoGiro(giros) : 'vazia';
        if (giro !== 'vazia') console.info(`[worker] giro 360° renderizado: ${giro}`);
        const video = videos ? await processarProximoVideo(videos) : 'vazia';
        if (video !== 'vazia') console.info(`[worker] vídeo de marketing renderizado: ${video}`);
        const bake = bakes ? await processarProximoBake(bakes) : 'vazia';
        if (bake !== 'vazia') console.info(`[worker] bake da luz assado: ${bake}`);
        if (r === 'vazia' && conversao === 'vazia' && planta === 'vazia' && giro === 'vazia' && video === 'vazia' && bake === 'vazia' && ativo) await esperar(extra.WORKER_INTERVALO_S * 1000);
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
