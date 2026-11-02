import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import type pg from 'pg';
import { withTenant } from '@imersa/db';
import type { Armazenamento } from '../arquivos/armazenamento';
import { nomeSeguro } from '../arquivos/tipos';
import { glbParaBlender, ModeloSemRender } from '../giros/descomprimir';

export type ResultadoBake =
  | { ok: true; glb: string; largura: number; dispositivo: string; mb: number; tempos_s?: Record<string, number> }
  | { ok: false; erro: string; mensagem: string; detalhes?: string[] };

/**
 * Modelo do prédio → GLB "assado": occlusionTexture padrão (AO, canal UV2) + extras com as texturas de luz
 * de dia e de noite (Plano 12a, item 6).
 */
export type Assador = (e: { glb: string; id: string; pasta: string }) => Promise<ResultadoBake>;

export interface DepsBake {
  pool: pg.Pool;
  armazenamento: Armazenamento;
  assador: Assador;
  pastaTrabalho: string;
  intervaloSinalMs?: number;
}

/** Falhas da nuvem (podem passar sozinhas): uma nova tentativa. */
const TRANSITORIOS = new Set(['falha_na_gpu', 'tempo_esgotado', 'falha_inesperada', 'falha_no_render', 'sem_internet']);
const MAX_TENTATIVAS = 2;
const falhaInesperada = (mensagem: string): ResultadoBake => ({ ok: false, erro: 'falha_inesperada', mensagem });

/** Pega o próximo bake da fila (de qualquer empresa) e assa a luz. */
export async function processarProximoBake(d: DepsBake): Promise<'vazia' | 'ok' | 'erro'> {
  const alvo = (await d.pool.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM pegar_proximo_bake()')).rows[0];
  if (!alvo) return 'vazia';
  const ctx = { tenantId: alvo.tenant_id, userId: null };
  const b = await withTenant(d.pool, ctx, async (c) =>
    (
      await c.query<{ building_id: string; tentativas: number; project_id: string; predio: string; chave: string }>(
        `SELECT bk.building_id, bk.tentativas, b.project_id, b.nome AS predio, a.chave
           FROM bakes bk JOIN buildings b ON b.id = bk.building_id JOIN assets a ON a.id = bk.modelo_asset_id WHERE bk.id = $1`,
        [alvo.id],
      )
    ).rows[0]!,
  );
  const pasta = join(d.pastaTrabalho, `bake-${alvo.id}-t${b.tentativas}`);
  const sinal = setInterval(() => {
    void withTenant(d.pool, ctx, (c) => c.query("UPDATE bakes SET trabalho_em = now() WHERE id = $1 AND status = 'processando'", [alvo.id])).catch(() => undefined);
  }, d.intervaloSinalMs ?? 60_000);
  try {
    await mkdir(pasta, { recursive: true });
    let r: ResultadoBake;
    try {
      const glb = join(pasta, 'modelo.glb');
      await writeFile(glb, await glbParaBlender(new Uint8Array(await buffer(await d.armazenamento.abrirLeitura(b.chave)))));
      r = await d.assador({ glb, id: `${alvo.id.slice(0, 8)}-t${b.tentativas}`, pasta });
    } catch (e) {
      r = e instanceof ModeloSemRender ? { ok: false, erro: 'modelo_invalido', mensagem: e.message } : falhaInesperada('Falha inesperada no bake. Uma nova tentativa será feita.');
    }

    if (r.ok) {
      const dados = await readFile(r.glb);
      const assetId = randomUUID();
      const nome = `${b.predio}-assado.glb`;
      const chave = `${alvo.tenant_id}/${b.project_id}/${assetId}/${nomeSeguro(nome)}`;
      await d.armazenamento.salvar(chave, dados, 'model/gltf-binary');
      const metricas = { dispositivo: r.dispositivo, mb: r.mb, largura: r.largura, tempos_s: r.tempos_s ?? {} };
      const gravou = await withTenant(d.pool, ctx, async (c) => {
        const st = (await c.query<{ status: string }>('SELECT status FROM bakes WHERE id = $1 FOR UPDATE', [alvo.id])).rows[0]?.status;
        if (st !== 'processando') return false;
        // GLB gerado pelo próprio sistema a partir de um modelo já verificado: entra pronto
        await c.query(
          `INSERT INTO assets (id, project_id, tipo, nome, chave, tamanho_declarado, tamanho, sha256, status, verificado_antivirus)
           VALUES ($1, $2, 'bake', $3, $4, $5, $5, $6, 'pronto', false)`,
          [assetId, b.project_id, nome, chave, dados.length, createHash('sha256').update(dados).digest('hex')],
        );
        await c.query("UPDATE bakes SET status = 'pronto', mensagem = NULL, glb_asset_id = $2, metricas = $3 WHERE id = $1", [alvo.id, assetId, JSON.stringify(metricas)]);
        // o bake novo substitui os anteriores do prédio: os GLB antigos só ocupariam espaço
        const antigos = (
          await c.query<{ chave: string }>(`DELETE FROM assets a USING bakes bk WHERE bk.building_id = $1 AND bk.id <> $2 AND bk.glb_asset_id = a.id RETURNING a.chave`, [
            b.building_id,
            alvo.id,
          ])
        ).rows;
        return antigos.map((a) => a.chave);
      });
      if (!gravou) await d.armazenamento.apagar(chave);
      else for (const antiga of gravou) await d.armazenamento.apagar(antiga).catch(() => undefined);
      return 'ok';
    }

    const repetir = TRANSITORIOS.has(r.erro) && b.tentativas < MAX_TENTATIVAS;
    await withTenant(d.pool, ctx, (c) =>
      c.query("UPDATE bakes SET status = $2, mensagem = $3 WHERE id = $1 AND status = 'processando'", [alvo.id, repetir ? 'na_fila' : 'erro', r.mensagem.slice(0, 1000)]),
    );
    return 'erro';
  } finally {
    clearInterval(sinal);
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Motor real: `python -m imersa_recon.bake` (Blender Cycles na GPU gratuita do Kaggle, ou num Blender local). */
export function assadorPython(o: {
  python: string;
  diretorio: string;
  usuarioKaggle?: string;
  blender?: string;
  /** Qualidade (padrão do serviço: textura de 1K). */
  qualidade?: { largura?: number; amostras?: number };
}): Assador {
  return (e) =>
    new Promise((ok) => {
      const resultado = join(e.pasta, 'resultado.json');
      const args = ['-m', 'imersa_recon.bake', '--glb', e.glb, '--id', e.id, '--saida', join(e.pasta, 'trabalho'), '--resultado', resultado];
      for (const [chave, valor] of Object.entries(o.qualidade ?? {})) if (valor !== undefined) args.push(`--${chave}`, String(valor));
      if (o.blender) args.push('--blender', o.blender);
      else args.push('--usuario', o.usuarioKaggle ?? '');
      const p = spawn(o.python, args, { cwd: o.diretorio, stdio: 'ignore', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      p.on('error', () => ok(falhaInesperada('Não foi possível iniciar o bake da luz.')));
      p.on('close', () => {
        readFile(resultado, 'utf8')
          .then((t) => ok(JSON.parse(t) as ResultadoBake))
          .catch(() => ok(falhaInesperada('O bake da luz terminou sem resultado.')));
      });
    });
}

/** Para testes e demonstração sem GPU: devolve um bake pronto (um GLB qualquer, só para o fluxo). */
export function assadorSimulado(glb: string): Assador {
  return async (e) => {
    const destino = join(e.pasta, 'assado.glb');
    await copyFile(glb, destino);
    return { ok: true, glb: destino, largura: 1024, dispositivo: 'simulado', mb: 0 };
  };
}
