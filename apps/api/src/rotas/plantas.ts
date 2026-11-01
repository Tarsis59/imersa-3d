import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
}

const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });
const px = z.number().min(-1e5).max(1e5);
const Segmento = z.object({ x1: px, y1: px, x2: px, y2: px, espessura: z.number().positive().max(1e4) });
/** O que a pessoa conferiu no editor: tudo em pixels da imagem da planta + a escala para metros. */
const Edicao = z.object({
  escalaMPorPx: z.number().positive().max(10),
  alturaParedeM: z.number().min(2).max(10),
  alturaPortaM: z.number().min(1.8).max(4),
  peitorilM: z.number().min(0).max(2),
  alturaJanelaM: z.number().min(0.3).max(4),
  paredes: z.array(Segmento).max(3000),
  aberturas: z.array(Segmento.extend({ tipo: z.enum(['porta', 'janela', 'passagem']) })).max(3000),
});
const NovaLeitura = z.object({ arquivoId: z.uuid() });
const Modelo = z.object({ arquivoId: z.uuid(), predioId: z.uuid().nullable().optional() });

export function rotasPlantas(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  /** Planta enviada (PDF, imagem, DXF) → fila de leitura (o worker detecta paredes, portas, janelas e cômodos). */
  app.post('/projetos/:id/plantas', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const { arquivoId } = NovaLeitura.parse(req.body);
    const nova = await withTenant(pool, ctx(s), async (c) => {
      const a = (await c.query<{ tipo: string; status: string; project_id: string; nome: string }>('SELECT tipo, status, project_id, nome FROM assets WHERE id = $1', [arquivoId])).rows[0];
      if (!a || a.project_id !== id) throw new ErroHttp(404, 'nao_encontrado');
      if (a.tipo !== 'planta' || a.status !== 'pronto') throw new ErroHttp(400, 'arquivo_invalido_para_planta');
      if (/\.dwg$/i.test(a.nome)) throw new ErroHttp(400, 'dwg_salvar_como_dxf');
      try {
        const r = (await c.query<{ id: string }>('INSERT INTO plantas (project_id, arquivo_id) VALUES ($1, $2) RETURNING id', [id, arquivoId])).rows[0]!;
        await registrarAuditoria(c, { userId: s.userId, acao: 'planta.ler', entidade: 'planta', entidadeId: r.id, depois: { arquivo: arquivoId } });
        return r;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ErroHttp(409, 'leitura_em_andamento');
        throw e;
      }
    });
    return reply.status(201).send(nova);
  });

  app.get('/projetos/:id/plantas', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM projects WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return (
        await c.query(
          `SELECT p.id, p.status, p.mensagem, p.arquivo_id AS "arquivoId", a.nome AS "arquivoNome", p.glb_asset_id AS "glbArquivoId",
                  p.edicao <> '{}'::jsonb AS editada, jsonb_array_length(coalesce(p.deteccao->'paredes', '[]')) AS paredes,
                  jsonb_array_length(coalesce(p.deteccao->'aberturas', '[]')) AS aberturas, jsonb_array_length(coalesce(p.deteccao->'comodos', '[]')) AS comodos,
                  p.criado_em AS "criadoEm"
             FROM plantas p JOIN assets a ON a.id = p.arquivo_id WHERE p.project_id = $1 ORDER BY p.criado_em DESC`,
          [id],
        )
      ).rows;
    });
  });

  async function carregar(c: pg.PoolClient, id: string) {
    const p = (
      await c.query(
        `SELECT p.id, p.status, p.mensagem, p.project_id AS "projetoId", pr.nome AS "projetoNome", a.nome AS "arquivoNome",
                p.imagem_asset_id AS "imagemArquivoId", p.deteccao, p.edicao, p.glb_asset_id AS "glbArquivoId"
           FROM plantas p JOIN assets a ON a.id = p.arquivo_id JOIN projects pr ON pr.id = p.project_id WHERE p.id = $1`,
        [id],
      )
    ).rows[0];
    if (!p) throw new ErroHttp(404, 'nao_encontrado');
    return p;
  }

  app.get('/plantas/:id', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), (c) => carregar(c, id));
  });

  app.put('/plantas/:id/edicao', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = Edicao.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      const p = await carregar(c, id);
      if (p.status !== 'pronto') throw new ErroHttp(409, 'planta_nao_lida');
      await c.query('UPDATE plantas SET edicao = $2 WHERE id = $1', [id, JSON.stringify(d)]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'planta.editar', entidade: 'planta', entidadeId: id, depois: { paredes: d.paredes.length, aberturas: d.aberturas.length } });
      return { ok: true };
    });
  });

  /** 3D gerado no editor (GLB já enviado e verificado em Arquivos) → liga à planta e, se pedido, vira o modelo do prédio. */
  app.post('/plantas/:id/modelo', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = Modelo.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      const p = await carregar(c, id);
      const a = (await c.query<{ tipo: string; status: string; project_id: string }>('SELECT tipo, status, project_id FROM assets WHERE id = $1', [d.arquivoId])).rows[0];
      if (!a || a.project_id !== p.projetoId || a.tipo !== 'modelo_3d' || a.status !== 'pronto') throw new ErroHttp(400, 'arquivo_invalido_para_modelo');
      await c.query('UPDATE plantas SET glb_asset_id = $2 WHERE id = $1', [id, d.arquivoId]);
      if (d.predioId) {
        if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1 AND project_id = $2', [d.predioId, p.projetoId])).rowCount) throw new ErroHttp(400, 'predio_de_outro_empreendimento');
        // modelo novo: peças ligadas às unidades no modelo anterior não existem neste
        await c.query('UPDATE units SET mesh_node_id = NULL WHERE building_id = $1', [d.predioId]);
        await c.query('UPDATE buildings SET modelo_asset_id = $2 WHERE id = $1', [d.predioId, d.arquivoId]);
      }
      await registrarAuditoria(c, { userId: s.userId, acao: 'planta.modelo', entidade: 'planta', entidadeId: id, depois: { arquivo: d.arquivoId, predio: d.predioId ?? null } });
      return { ok: true };
    });
  });
}
