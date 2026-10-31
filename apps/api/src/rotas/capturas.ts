import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import type { Armazenamento } from '../arquivos/armazenamento';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
  armazenamento: Armazenamento;
}

const NovaCaptura = z.object({ nome: z.string().trim().min(1).max(120), arquivoId: z.uuid() });
const PREVIA_S = 15 * 60;
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

const SELECAO = `SELECT c.id, c.project_id AS "projetoId", c.nome, c.status, c.mensagem, c.detalhes, c.avisos, c.metricas, c.tentativas,
       c.splat_asset_id AS "splatArquivoId", c.criado_em AS "criadoEm", c.atualizado_em AS "atualizadoEm",
       CASE WHEN lower(a.nome) LIKE '%.zip' THEN 'fotos' ELSE 'video' END AS origem, a.nome AS "arquivoNome"
  FROM capturas c JOIN assets a ON a.id = c.arquivo_id`;

export function rotasCapturas(app: FastifyInstance, { pool, exigir, armazenamento }: Dependencias): void {
  const buscar = async (c: pg.PoolClient, id: string) => {
    const r = (await c.query(`${SELECAO} WHERE c.id = $1`, [id])).rows[0];
    if (!r) throw new ErroHttp(404, 'nao_encontrado');
    return r as { id: string; status: string; nome: string; splatArquivoId: string | null };
  };

  app.post('/projetos/:id/capturas', async (req, reply) => {
    const s = await exigir(req, 'captura:enviar');
    const { id } = IdParam.parse(req.params);
    const n = NovaCaptura.parse(req.body);
    const nova = await withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM projects WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      const arq = (await c.query<{ tipo: string; status: string; project_id: string }>('SELECT tipo, status, project_id FROM assets WHERE id = $1', [n.arquivoId])).rows[0];
      if (!arq || arq.tipo !== 'captura' || arq.status !== 'pronto' || arq.project_id !== id) throw new ErroHttp(400, 'arquivo_invalido_para_captura');
      const r = (await c.query<{ id: string }>("INSERT INTO capturas (project_id, arquivo_id, nome, status) VALUES ($1, $2, $3, 'na_fila') RETURNING id", [id, n.arquivoId, n.nome])).rows[0]!;
      await registrarAuditoria(c, { userId: s.userId, acao: 'captura.criar', entidade: 'captura', entidadeId: r.id, depois: { nome: n.nome, projeto: id } });
      return r;
    });
    return reply.status(201).send(nova);
  });

  app.get('/projetos/:id/capturas', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM projects WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return (await c.query(`${SELECAO} WHERE c.project_id = $1 ORDER BY c.criado_em DESC`, [id])).rows;
    });
  });

  app.get('/capturas/:id', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), (c) => buscar(c, id));
  });

  /** Link curto para a gestão ver o 3D antes de publicar. */
  app.get('/capturas/:id/previa', async (req) => {
    const s = await exigir(req, 'captura:revisar');
    const { id } = IdParam.parse(req.params);
    const a = await withTenant(pool, ctx(s), async (c) => {
      const cap = await buscar(c, id);
      if (!cap.splatArquivoId || !['revisao', 'publicado'].includes(cap.status)) throw new ErroHttp(409, 'captura_sem_resultado');
      return (await c.query<{ chave: string; nome: string }>('SELECT chave, nome FROM assets WHERE id = $1', [cap.splatArquivoId])).rows[0]!;
    });
    const cap = await withTenant(pool, ctx(s), (c) => buscar(c, id));
    return { url: await armazenamento.urlDownload({ chave: a.chave, assetId: cap.splatArquivoId!, tenantId: s.tenantId, nomeArquivo: a.nome, expiraS: PREVIA_S }), nome: a.nome };
  });

  app.post('/capturas/:id/publicar', async (req) => {
    const s = await exigir(req, 'captura:revisar');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const cap = await buscar(c, id);
      if (cap.status !== 'revisao' || !cap.splatArquivoId) throw new ErroHttp(409, 'captura_nao_esta_em_revisao');
      await c.query("UPDATE assets SET status = 'pronto' WHERE id = $1 AND status = 'em_revisao'", [cap.splatArquivoId]);
      await c.query("UPDATE capturas SET status = 'publicado' WHERE id = $1", [id]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'captura.publicar', entidade: 'captura', entidadeId: id, depois: { arquivo: cap.splatArquivoId } });
      return { arquivoId: cap.splatArquivoId };
    });
  });

  app.post('/capturas/:id/cancelar', async (req) => {
    const s = await exigir(req, 'captura:revisar');
    const { id } = IdParam.parse(req.params);
    const apagar = await withTenant(pool, ctx(s), async (c) => {
      const cap = await buscar(c, id);
      if (['publicado', 'cancelado'].includes(cap.status)) throw new ErroHttp(409, 'captura_nao_pode_ser_cancelada');
      await c.query("UPDATE capturas SET status = 'cancelado' WHERE id = $1", [id]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'captura.cancelar', entidade: 'captura', entidadeId: id, antes: { status: cap.status } });
      // resultado em revisão é descartado (não fica ocupando espaço)
      if (!cap.splatArquivoId) return null;
      return (await c.query<{ chave: string }>("DELETE FROM assets WHERE id = $1 AND status = 'em_revisao' RETURNING chave", [cap.splatArquivoId])).rows[0]?.chave ?? null;
    });
    if (apagar) await armazenamento.apagar(apagar);
    return { status: 'cancelado' };
  });

  app.post('/capturas/:id/reenviar', async (req) => {
    const s = await exigir(req, 'captura:revisar');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const cap = await buscar(c, id);
      if (!['erro', 'cancelado'].includes(cap.status)) throw new ErroHttp(409, 'captura_nao_pode_ser_reenviada');
      await c.query("UPDATE capturas SET status = 'na_fila', tentativas = 0, mensagem = NULL, detalhes = '[]', trabalho_em = NULL WHERE id = $1", [id]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'captura.reenviar', entidade: 'captura', entidadeId: id });
      return { status: 'na_fila' };
    });
  });
}
