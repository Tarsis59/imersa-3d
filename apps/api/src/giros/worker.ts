import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import type pg from 'pg';
import { withTenant } from '@imersa/db';
import type { Armazenamento } from '../arquivos/armazenamento';
import { nomeSeguro } from '../arquivos/tipos';
import { glbParaBlender, ModeloSemRender } from './descomprimir';

export interface EntradaGiro {
  /** GLB do prédio já sem Meshopt (o Blender abre). */
  glb: string;
  /** Nós das unidades, na ordem dos índices das máscaras. */
  nos: string[];
  /** Identificador único desta tentativa (vira nome de dataset e notebook no Kaggle). */
  id: string;
  pasta: string;
}

export type ResultadoGiro =
  | { ok: true; zip: string; quadros: number; largura: number; altura: number; dispositivo: string; mb: number; nos_sem_peca: string[]; tempos_s?: Record<string, number> }
  | { ok: false; erro: string; mensagem: string; detalhes?: string[] };

/** Modelo do prédio + unidades → giro.zip (quadros coloridos, máscaras e giro.json). */
export type Renderizador = (e: EntradaGiro) => Promise<ResultadoGiro>;

export interface DepsGiro {
  pool: pg.Pool;
  armazenamento: Armazenamento;
  renderizador: Renderizador;
  pastaTrabalho: string;
  intervaloSinalMs?: number;
}

/** Falhas da nuvem (podem passar sozinhas): uma nova tentativa. */
const TRANSITORIOS = new Set(['falha_na_gpu', 'tempo_esgotado', 'falha_inesperada', 'falha_no_render', 'sem_internet']);
const MAX_TENTATIVAS = 2;
const falhaInesperada = (mensagem: string): ResultadoGiro => ({ ok: false, erro: 'falha_inesperada', mensagem });

/** Pega o próximo giro da fila (de qualquer empresa) e renderiza. */
export async function processarProximoGiro(d: DepsGiro): Promise<'vazia' | 'ok' | 'erro'> {
  const alvo = (await d.pool.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM pegar_proximo_giro()')).rows[0];
  if (!alvo) return 'vazia';
  const ctx = { tenantId: alvo.tenant_id, userId: null };
  const g = await withTenant(d.pool, ctx, async (c) => {
    const giro = (
      await c.query<{ building_id: string; tentativas: number; project_id: string; predio: string; chave: string }>(
        `SELECT g.building_id, g.tentativas, b.project_id, b.nome AS predio, a.chave
           FROM giros g JOIN buildings b ON b.id = g.building_id JOIN assets a ON a.id = g.modelo_asset_id WHERE g.id = $1`,
        [alvo.id],
      )
    ).rows[0]!;
    // unidades ligadas a peças do modelo, numa ordem fixa: o índice vira a cor-ID da máscara
    const unidades = (
      await c.query<{ id: string; no: string }>('SELECT id, mesh_node_id AS no FROM units WHERE building_id = $1 AND mesh_node_id IS NOT NULL ORDER BY id', [giro.building_id])
    ).rows;
    return { ...giro, unidades };
  });
  const pasta = join(d.pastaTrabalho, `giro-${alvo.id}-t${g.tentativas}`);
  const sinal = setInterval(() => {
    void withTenant(d.pool, ctx, (c) => c.query("UPDATE giros SET trabalho_em = now() WHERE id = $1 AND status = 'processando'", [alvo.id])).catch(() => undefined);
  }, d.intervaloSinalMs ?? 60_000);
  try {
    await mkdir(pasta, { recursive: true });
    let r: ResultadoGiro;
    try {
      const glb = join(pasta, 'modelo.glb');
      await writeFile(glb, await glbParaBlender(new Uint8Array(await buffer(await d.armazenamento.abrirLeitura(g.chave)))));
      r = await d.renderizador({ glb, nos: g.unidades.map((u) => u.no), id: `${alvo.id.slice(0, 8)}-t${g.tentativas}`, pasta });
    } catch (e) {
      r = e instanceof ModeloSemRender ? { ok: false, erro: 'modelo_invalido', mensagem: e.message } : falhaInesperada('Falha inesperada no render. Uma nova tentativa será feita.');
    }

    if (r.ok) {
      const dados = await readFile(r.zip);
      const assetId = randomUUID();
      const nome = `giro-360-${g.predio}.zip`;
      const chave = `${alvo.tenant_id}/${g.project_id}/${assetId}/${nomeSeguro(nome)}`;
      await d.armazenamento.salvar(chave, dados, 'application/zip');
      const metricas = { dispositivo: r.dispositivo, mb: r.mb, largura: r.largura, altura: r.altura, tempos_s: r.tempos_s ?? {}, unidadesSemPeca: r.nos_sem_peca.length };
      const gravou = await withTenant(d.pool, ctx, async (c) => {
        const st = (await c.query<{ status: string }>('SELECT status FROM giros WHERE id = $1 FOR UPDATE', [alvo.id])).rows[0]?.status;
        if (st !== 'processando') return false;
        // ZIP gerado pelo próprio sistema a partir de um modelo já verificado: entra pronto
        await c.query(
          `INSERT INTO assets (id, project_id, tipo, nome, chave, tamanho_declarado, tamanho, sha256, status, verificado_antivirus)
           VALUES ($1, $2, 'giro', $3, $4, $5, $5, $6, 'pronto', false)`,
          [assetId, g.project_id, nome, chave, dados.length, createHash('sha256').update(dados).digest('hex')],
        );
        await c.query("UPDATE giros SET status = 'pronto', mensagem = NULL, zip_asset_id = $2, unidades = $3, quadros = $4, metricas = $5 WHERE id = $1", [
          alvo.id,
          assetId,
          JSON.stringify(g.unidades.map((u) => u.id)),
          r.quadros,
          JSON.stringify(metricas),
        ]);
        // o giro novo substitui os anteriores do prédio: os ZIPs antigos só ocupariam espaço
        const antigos = (
          await c.query<{ chave: string }>(
            `DELETE FROM assets a USING giros g WHERE g.building_id = $1 AND g.id <> $2 AND g.zip_asset_id = a.id RETURNING a.chave`,
            [g.building_id, alvo.id],
          )
        ).rows;
        return antigos.map((a) => a.chave);
      });
      if (!gravou) await d.armazenamento.apagar(chave);
      else for (const antiga of gravou) await d.armazenamento.apagar(antiga).catch(() => undefined);
      return 'ok';
    }

    const repetir = TRANSITORIOS.has(r.erro) && g.tentativas < MAX_TENTATIVAS;
    await withTenant(d.pool, ctx, (c) =>
      c.query("UPDATE giros SET status = $2, mensagem = $3 WHERE id = $1 AND status = 'processando'", [alvo.id, repetir ? 'na_fila' : 'erro', r.mensagem.slice(0, 1000)]),
    );
    return 'erro';
  } finally {
    clearInterval(sinal);
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Motor real: `python -m imersa_recon.giro` (Blender Cycles na GPU gratuita do Kaggle, ou num Blender local). */
export function renderizadorPython(o: {
  python: string;
  diretorio: string;
  usuarioKaggle?: string;
  blender?: string;
  /** Qualidade (padrão do serviço: 72 quadros de 1280×720 com 96 amostras). */
  qualidade?: { quadros?: number; largura?: number; altura?: number; amostras?: number };
}): Renderizador {
  return (e) =>
    new Promise((ok) => {
      const resultado = join(e.pasta, 'resultado.json');
      const nos = join(e.pasta, 'nos.json');
      void writeFile(nos, JSON.stringify(e.nos)).then(() => {
        const args = ['-m', 'imersa_recon.giro', '--glb', e.glb, '--nos', nos, '--id', e.id, '--saida', join(e.pasta, 'trabalho'), '--resultado', resultado];
        for (const [chave, valor] of Object.entries(o.qualidade ?? {})) if (valor !== undefined) args.push(`--${chave}`, String(valor));
        if (o.blender) args.push('--blender', o.blender);
        else args.push('--usuario', o.usuarioKaggle ?? '');
        const p = spawn(o.python, args, { cwd: o.diretorio, stdio: 'ignore', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        p.on('error', () => ok(falhaInesperada('Não foi possível iniciar o render do giro.')));
        p.on('close', () => {
          readFile(resultado, 'utf8')
            .then((t) => ok(JSON.parse(t) as ResultadoGiro))
            .catch(() => ok(falhaInesperada('O render do giro terminou sem resultado.')));
        });
      }, () => ok(falhaInesperada('Não foi possível preparar o render do giro.')));
    });
}

/** Para testes e demonstração sem GPU: devolve um giro pronto. */
export function renderizadorSimulado(zip: string, quadros: number): Renderizador {
  return async (e) => {
    const destino = join(e.pasta, 'giro.zip');
    await copyFile(zip, destino);
    return { ok: true, zip: destino, quadros, largura: 1280, altura: 720, dispositivo: 'simulado', mb: 0, nos_sem_peca: [] };
  };
}
