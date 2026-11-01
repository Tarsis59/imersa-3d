import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type pg from 'pg';
import { withTenant } from '@imersa/db';
import type { Armazenamento } from '../arquivos/armazenamento';
import { nomeSeguro } from '../arquivos/tipos';

export type ResultadoLeitura = { ok: true; imagem: string; deteccao: Record<string, unknown> } | { ok: false; recusado: boolean; mensagem: string };

/** Planta baixada (PDF, imagem, DXF) → PNG da planta + paredes, aberturas e cômodos detectados. */
export type LeitorPlanta = (entrada: string, pasta: string) => Promise<ResultadoLeitura>;

export interface DepsPlanta {
  pool: pg.Pool;
  armazenamento: Armazenamento;
  leitor: LeitorPlanta;
  pastaTrabalho: string;
}

const MAX_TENTATIVAS = 2;

/** Lê a próxima planta da fila. 'vazia' quando não há nada. */
export async function processarProximaPlanta(d: DepsPlanta): Promise<'vazia' | 'ok' | 'erro' | 'repetir'> {
  const alvo = (await d.pool.query<{ id: string; tenant_id: string }>('SELECT * FROM pegar_proxima_planta()')).rows[0];
  if (!alvo) return 'vazia';
  const ctx = { tenantId: alvo.tenant_id, userId: null };
  const p = await withTenant(d.pool, ctx, async (c) =>
    (
      await c.query<{ project_id: string; tentativas: number; chave: string; nome: string }>(
        'SELECT p.project_id, p.tentativas, a.chave, a.nome FROM plantas p JOIN assets a ON a.id = p.arquivo_id WHERE p.id = $1',
        [alvo.id],
      )
    ).rows[0]!,
  );
  const pasta = join(d.pastaTrabalho, `planta-${alvo.id}`);
  let r: ResultadoLeitura;
  try {
    await mkdir(pasta, { recursive: true });
    const entrada = join(pasta, `planta${extname(p.nome).toLowerCase()}`);
    await pipeline(await d.armazenamento.abrirLeitura(p.chave), createWriteStream(entrada));
    r = await d.leitor(entrada, pasta);
  } catch {
    r = { ok: false, recusado: false, mensagem: 'Falha inesperada na leitura da planta. Uma nova tentativa será feita.' };
  }
  try {
    if (r.ok) {
      const dados = await readFile(r.imagem);
      const assetId = randomUUID();
      const nome = `${p.nome.replace(/\.[^.]+$/, '')}-planta.png`;
      const chave = `${alvo.tenant_id}/${p.project_id}/${assetId}/${nomeSeguro(nome)}`;
      await d.armazenamento.salvar(chave, dados, 'image/png');
      await withTenant(d.pool, ctx, async (c) => {
        // imagem gerada pelo próprio sistema a partir de uma planta já verificada: entra pronta
        await c.query(
          `INSERT INTO assets (id, project_id, tipo, nome, chave, tamanho_declarado, tamanho, sha256, status, verificado_antivirus)
           VALUES ($1, $2, 'imagem', $3, $4, $5, $5, $6, 'pronto', false)`,
          [assetId, p.project_id, nome, chave, dados.length, createHash('sha256').update(dados).digest('hex')],
        );
        await c.query("UPDATE plantas SET status = 'pronto', mensagem = NULL, imagem_asset_id = $2, deteccao = $3 WHERE id = $1", [alvo.id, assetId, JSON.stringify(r.deteccao)]);
      });
      return 'ok';
    }
    const repetir = !r.recusado && p.tentativas < MAX_TENTATIVAS;
    await withTenant(d.pool, ctx, (c) => c.query('UPDATE plantas SET status = $2, mensagem = $3 WHERE id = $1', [alvo.id, repetir ? 'na_fila' : 'erro', r.mensagem.slice(0, 1000)]));
    return repetir ? 'repetir' : 'erro';
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Motor real: `python -m imersa_planta` (OpenCV, pypdfium2, ezdxf). Código 2 = planta recusada (formato, arquivo ruim). */
export function leitorPython(o: { python: string; diretorio: string }): LeitorPlanta {
  return (entrada, pasta) =>
    new Promise((resolver) => {
      const imagem = join(pasta, 'planta.png');
      const resultado = join(pasta, 'resultado.json');
      const proc = spawn(o.python, ['-m', 'imersa_planta', '--entrada', entrada, '--imagem', imagem, '--resultado', resultado], {
        cwd: o.diretorio,
        stdio: 'ignore',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      const limite = setTimeout(() => proc.kill(), 5 * 60_000);
      proc.on('error', () => resolver({ ok: false, recusado: false, mensagem: 'Não foi possível iniciar o leitor de plantas.' }));
      proc.on('exit', async (codigo) => {
        clearTimeout(limite);
        try {
          const r = JSON.parse(await readFile(resultado, 'utf8')) as Record<string, unknown> & { erro?: string };
          if (codigo === 2 || r.erro) return resolver({ ok: false, recusado: true, mensagem: String(r.erro ?? 'Planta recusada.') });
          resolver({ ok: true, imagem, deteccao: r });
        } catch {
          resolver({ ok: false, recusado: false, mensagem: 'O leitor de plantas terminou sem resultado.' });
        }
      });
    });
}
