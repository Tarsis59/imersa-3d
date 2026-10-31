import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type pg from 'pg';
import { withTenant } from '@imersa/db';
import type { Armazenamento } from '../arquivos/armazenamento';
import { nomeSeguro } from '../arquivos/tipos';

export interface EntradaReconstrucao {
  /** Arquivo enviado (ZIP de fotos ou vídeo), já baixado do armazenamento. */
  arquivo: string;
  tipo: 'zip' | 'video';
  /** Identificador único desta tentativa (vira nome de dataset no Kaggle). */
  id: string;
  /** Pasta de trabalho só desta tentativa. */
  pasta: string;
}

export type ResultadoReconstrucao =
  | { ok: true; splat: string; avisos: string[]; metricas: Record<string, unknown>; rostos_desfocados: number }
  | { ok: false; erro: string; mensagem: string; detalhes: string[] };

export type Reconstrutor = (e: EntradaReconstrucao) => Promise<ResultadoReconstrucao>;

export interface DepsWorker {
  pool: pg.Pool;
  armazenamento: Armazenamento;
  reconstrutor: Reconstrutor;
  pastaTrabalho: string;
  /** Sinal de vida da captura em processamento (captura sem sinal há 2 h volta para a fila). */
  intervaloSinalMs?: number;
}

/** Falhas da nuvem (podem passar sozinhas): uma nova tentativa. Fotos ruins não: a pessoa precisa refazer. */
const TRANSITORIOS = new Set(['falha_na_gpu', 'tempo_esgotado', 'falha_inesperada']);
const MAX_TENTATIVAS = 2;
const falhaInesperada = (mensagem: string): ResultadoReconstrucao => ({ ok: false, erro: 'falha_inesperada', mensagem, detalhes: [] });

/** Pega a próxima captura da fila (de qualquer empresa) e processa. */
export async function processarProxima(d: DepsWorker): Promise<'vazia' | 'ok' | 'erro'> {
  const alvo = (await d.pool.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM pegar_proxima_captura()')).rows[0];
  if (!alvo) return 'vazia';
  const ctx = { tenantId: alvo.tenant_id, userId: null };
  const cap = (
    await withTenant(d.pool, ctx, (c) =>
      c.query<{ nome: string; tentativas: number; project_id: string; chave: string; arquivo: string }>(
        'SELECT c.nome, c.tentativas, c.project_id, a.chave, a.nome AS arquivo FROM capturas c JOIN assets a ON a.id = c.arquivo_id WHERE c.id = $1',
        [alvo.id],
      ),
    )
  ).rows[0]!;
  const pasta = join(d.pastaTrabalho, `${alvo.id}-t${cap.tentativas}`);
  const sinal = setInterval(() => {
    void withTenant(d.pool, ctx, (c) => c.query("UPDATE capturas SET trabalho_em = now() WHERE id = $1 AND status = 'processando'", [alvo.id])).catch(() => undefined);
  }, d.intervaloSinalMs ?? 60_000);
  try {
    await mkdir(pasta, { recursive: true });
    const ext = extname(cap.arquivo).toLowerCase();
    const entrada = join(pasta, `entrada${ext}`);
    let r: ResultadoReconstrucao;
    try {
      await pipeline(await d.armazenamento.abrirLeitura(cap.chave), createWriteStream(entrada));
      r = await d.reconstrutor({ arquivo: entrada, tipo: ext === '.zip' ? 'zip' : 'video', id: `cap-${alvo.id.slice(0, 8)}-t${cap.tentativas}`, pasta });
    } catch {
      r = falhaInesperada('Falha inesperada no processamento. Uma nova tentativa será feita.');
    }

    if (r.ok) {
      const dados = await readFile(r.splat);
      const assetId = randomUUID();
      const nome = `${cap.nome}${extname(r.splat).toLowerCase() || '.sog'}`;
      const chave = `${alvo.tenant_id}/${cap.project_id}/${assetId}/${nomeSeguro(nome)}`;
      await d.armazenamento.salvar(chave, dados, 'application/octet-stream');
      const gravou = await withTenant(d.pool, ctx, async (c) => {
        // cancelada enquanto processava: não sobrescreve
        const st = (await c.query<{ status: string }>('SELECT status FROM capturas WHERE id = $1 FOR UPDATE', [alvo.id])).rows[0]?.status;
        if (st !== 'processando') return false;
        await c.query(
          `INSERT INTO assets (id, project_id, tipo, nome, chave, tamanho_declarado, tamanho, sha256, status, verificado_antivirus)
           VALUES ($1, $2, 'splat', $3, $4, $5, $5, $6, 'em_revisao', false)`,
          [assetId, cap.project_id, nome, chave, dados.length, createHash('sha256').update(dados).digest('hex')],
        );
        await c.query(
          "UPDATE capturas SET status = 'revisao', splat_asset_id = $2, metricas = $3, avisos = $4, mensagem = NULL, detalhes = '[]' WHERE id = $1",
          [alvo.id, assetId, JSON.stringify({ ...r.metricas, rostosDesfocados: r.rostos_desfocados }), JSON.stringify(r.avisos)],
        );
        return true;
      });
      if (!gravou) await d.armazenamento.apagar(chave);
      return 'ok';
    }

    const repetir = TRANSITORIOS.has(r.erro) && cap.tentativas < MAX_TENTATIVAS;
    await withTenant(d.pool, ctx, (c) =>
      c.query("UPDATE capturas SET status = $2, mensagem = $3, detalhes = $4 WHERE id = $1 AND status = 'processando'", [
        alvo.id,
        repetir ? 'na_fila' : 'erro',
        r.mensagem.slice(0, 1000),
        JSON.stringify(r.detalhes.slice(0, 50)),
      ]),
    );
    return 'erro';
  } finally {
    clearInterval(sinal);
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Motor real: `python -m imersa_recon.reconstruir` (serviço Python, GPU gratuita do Kaggle). */
export function reconstrutorPython(o: { python: string; diretorio: string; usuarioKaggle: string }): Reconstrutor {
  return (e) =>
    new Promise((ok) => {
      const resultado = join(e.pasta, 'resultado.json');
      const args = ['-m', 'imersa_recon.reconstruir', e.tipo === 'zip' ? '--zip' : '--video', e.arquivo, '--id', e.id];
      args.push('--usuario', o.usuarioKaggle, '--trabalho', join(e.pasta, 'trabalho'), '--resultado', resultado);
      const p = spawn(o.python, args, { cwd: o.diretorio, stdio: 'ignore', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      p.on('error', () => ok(falhaInesperada('Não foi possível iniciar o motor de reconstrução.')));
      p.on('close', () => {
        readFile(resultado, 'utf8')
          .then((t) => ok(JSON.parse(t) as ResultadoReconstrucao))
          .catch(() => ok(falhaInesperada('O motor de reconstrução terminou sem resultado.')));
      });
    });
}

/** Para testes e demonstração sem GPU: devolve um splat pronto. */
export function reconstrutorSimulado(splat: string): Reconstrutor {
  return async (e) => {
    const destino = join(e.pasta, 'cena.sog');
    await copyFile(splat, destino);
    return { ok: true, splat: destino, avisos: [], metricas: { simulado: true }, rostos_desfocados: 0 };
  };
}
