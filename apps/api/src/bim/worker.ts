import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type pg from 'pg';
import { withTenant } from '@imersa/db';
import type { Armazenamento } from '../arquivos/armazenamento';
import { nomeSeguro } from '../arquivos/tipos';

export type ResultadoConversao =
  | { ok: true; glb: string; metadados: Record<string, unknown>; elementos: number; bytesOriginal: number; bytes: number }
  | { ok: false; erro: string; mensagem: string };

/** IFC baixado → GLB otimizado + metadados (pavimentos, ambientes, áreas). */
export type ConversorBim = (ifc: string, pasta: string) => Promise<ResultadoConversao>;

export interface DepsBim {
  pool: pg.Pool;
  armazenamento: Armazenamento;
  conversor: ConversorBim;
  pastaTrabalho: string;
}

/** Arquivo recusado (IFC inválido, sem geometria) não melhora tentando de novo; falha da máquina, sim (uma vez). */
const RECUSADOS = new Set(['ifc_invalido', 'sem_geometria']);
const MAX_TENTATIVAS = 2;

/** Converte a próxima da fila. 'vazia' quando não há nada. */
export async function processarProximaConversao(d: DepsBim): Promise<'vazia' | 'ok' | 'erro' | 'repetir'> {
  const alvo = (await d.pool.query<{ id: string; tenant_id: string }>('SELECT * FROM pegar_proxima_conversao()')).rows[0];
  if (!alvo) return 'vazia';
  const ctx = { tenantId: alvo.tenant_id, userId: null };
  const conv = await withTenant(d.pool, ctx, async (c) =>
    (
      await c.query<{ project_id: string; tentativas: number; chave: string; nome: string }>(
        'SELECT v.project_id, v.tentativas, a.chave, a.nome FROM conversoes_bim v JOIN assets a ON a.id = v.arquivo_id WHERE v.id = $1',
        [alvo.id],
      )
    ).rows[0]!,
  );
  const pasta = join(d.pastaTrabalho, `bim-${alvo.id}`);
  let r: ResultadoConversao;
  try {
    await mkdir(pasta, { recursive: true });
    const entrada = join(pasta, 'projeto.ifc');
    await pipeline(await d.armazenamento.abrirLeitura(conv.chave), createWriteStream(entrada));
    r = await d.conversor(entrada, pasta);
  } catch {
    r = { ok: false, erro: 'falha_inesperada', mensagem: 'Falha inesperada na conversão. Uma nova tentativa será feita.' };
  }

  try {
    if (r.ok) {
      const dados = await readFile(r.glb);
      const assetId = randomUUID();
      const nome = `${conv.nome.replace(/\.ifc$/i, '')}.glb`;
      const chave = `${alvo.tenant_id}/${conv.project_id}/${assetId}/${nomeSeguro(nome)}`;
      await d.armazenamento.salvar(chave, dados, 'model/gltf-binary');
      await withTenant(d.pool, ctx, async (c) => {
        // modelo gerado pelo próprio sistema a partir de um IFC já verificado: entra pronto
        await c.query(
          `INSERT INTO assets (id, project_id, tipo, nome, chave, tamanho_declarado, tamanho, sha256, status, verificado_antivirus)
           VALUES ($1, $2, 'modelo_3d', $3, $4, $5, $5, $6, 'pronto', false)`,
          [assetId, conv.project_id, nome, chave, dados.length, createHash('sha256').update(dados).digest('hex')],
        );
        await c.query(
          "UPDATE conversoes_bim SET status = 'pronto', mensagem = NULL, glb_asset_id = $2, metadados = $3 WHERE id = $1",
          [alvo.id, assetId, JSON.stringify({ ...r.metadados, elementos: r.elementos, bytesOriginal: r.bytesOriginal, bytes: r.bytes })],
        );
      });
      return 'ok';
    }
    const repetir = !RECUSADOS.has(r.erro) && conv.tentativas < MAX_TENTATIVAS;
    await withTenant(d.pool, ctx, (c) =>
      c.query('UPDATE conversoes_bim SET status = $2, mensagem = $3 WHERE id = $1', [alvo.id, repetir ? 'na_fila' : 'erro', r.mensagem.slice(0, 1000)]),
    );
    return repetir ? 'repetir' : 'erro';
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Motor real: `python -m imersa_bim` (IfcOpenShell + gltf-transform). */
export function conversorPython(o: { python: string; diretorio: string }): ConversorBim {
  return (ifc, pasta) =>
    new Promise((resolver) => {
      const glb = join(pasta, 'modelo.glb');
      const resultado = join(pasta, 'resultado.json');
      const p = spawn(o.python, ['-m', 'imersa_bim', '--ifc', ifc, '--glb', glb, '--resultado', resultado], {
        cwd: o.diretorio,
        stdio: 'ignore',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      const limite = setTimeout(() => p.kill(), 30 * 60_000);
      p.on('error', () => resolver({ ok: false, erro: 'falha_inesperada', mensagem: 'Não foi possível iniciar o conversor BIM.' }));
      p.on('exit', async () => {
        clearTimeout(limite);
        try {
          const r = JSON.parse(await readFile(resultado, 'utf8')) as ResultadoConversao & { ok: boolean };
          resolver(r.ok ? { ...(r as Extract<ResultadoConversao, { ok: true }>), glb } : r);
        } catch {
          resolver({ ok: false, erro: 'falha_inesperada', mensagem: 'O conversor BIM terminou sem resultado.' });
        }
      });
    });
}
