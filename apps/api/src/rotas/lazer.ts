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

export const CATEGORIAS_LAZER = ['piscina', 'academia', 'salao_festas', 'churrasqueira', 'playground', 'quadra', 'espaco_gourmet', 'brinquedoteca', 'coworking', 'pet', 'jardim', 'outro'] as const;
/** No máximo por prédio: o tour do lazer é curto (~2 min). */
export const MAX_LAZER = 30;
const metros = (max: number) => z.number().finite().min(-max).max(max);
/** Até 12 fotos por ficha (Plano 12b, item 6): ids de arquivos já prontos no projeto (conferido na rota). */
const FotosFicha = z.array(z.uuid()).max(12).optional();
const NovoLazer = z.object({
  categoria: z.enum(CATEGORIAS_LAZER),
  nome: z.string().trim().min(1).max(120),
  descricao: z.string().trim().max(600).nullish(),
  x: metros(2000),
  y: z.number().finite().min(-50).max(600).default(0),
  z: metros(2000),
  ordem: z.number().int().min(0).max(1000).optional(),
  fotos: FotosFicha,
});
const EdicaoLazer = NovoLazer.omit({ y: true }).partial().extend({ y: z.number().finite().min(-50).max(600).optional() });
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

export interface ItemLazer {
  id: string;
  categoria: (typeof CATEGORIAS_LAZER)[number];
  nome: string;
  descricao: string | null;
  x: number;
  y: number;
  z: number;
  ordem: number;
  fotos: string[];
}

/** Lazer do prédio na ordem do tour (o portal do cliente e o estande usam a mesma lista). */
export async function lazerDoPredio(c: pg.PoolClient, predioId: string): Promise<ItemLazer[]> {
  return (
    await c.query<ItemLazer>(
      'SELECT id, categoria, nome, descricao, x_m AS x, y_m AS y, z_m AS z, ordem, coalesce(fotos, array[]::uuid[]) AS fotos FROM lazer WHERE building_id = $1 ORDER BY ordem, criado_em',
      [predioId],
    )
  ).rows;
}

/**
 * Fotos do imóvel com GPS (Plano 11c, item 14): viram quadros no 3D onde foram tiradas. Só foto, fachada e render que
 * a gestão confirmou na criação; documento e planta nunca aparecem aqui.
 */
export async function fotosNoLugar(c: pg.PoolClient, projetoId: string): Promise<Array<{ id: string; nome: string; lat: number; lon: number; rumo: number | null }>> {
  return (
    await c.query(
      `SELECT id, nome, lat, lon, rumo FROM assets
        WHERE project_id = $1 AND status = 'pronto' AND tipo = 'imagem' AND lat IS NOT NULL AND papel IN ('foto', 'fachada', 'render')
        ORDER BY criado_em LIMIT 60`,
      [projetoId],
    )
  ).rows;
}

/**
 * Todas as fotos prontas do projeto (sem exigir GPS): para a gestão escolher as da ficha do lazer (item 6) e da
 * galeria do empreendimento (item 7).
 */
export async function fotosDoProjeto(c: pg.PoolClient, projetoId: string): Promise<Array<{ id: string; nome: string }>> {
  return (
    await c.query(
      `SELECT id, nome FROM assets
        WHERE project_id = $1 AND status = 'pronto' AND tipo = 'imagem'
        ORDER BY criado_em LIMIT 200`,
      [projetoId],
    )
  ).rows;
}

/** Confere que todas as fotos existem, prontas, no projeto do prédio (nunca confiar em ids vindos do cliente). */
async function conferirFotos(c: pg.PoolClient, predioId: string, fotos: string[]): Promise<void> {
  if (!fotos.length) return;
  const r = await c.query<{ id: string }>(
    `SELECT a.id FROM assets a JOIN buildings b ON b.project_id = a.project_id
      WHERE b.id = $1 AND a.status = 'pronto' AND a.tipo = 'imagem' AND a.id = ANY($2::uuid[])`,
    [predioId, fotos],
  );
  if (r.rowCount !== fotos.length) throw new ErroHttp(400, 'foto_invalida');
}

export function rotasLazer(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  /** Fotos com GPS do empreendimento do prédio: quadros no 3D. */
  app.get('/predios/:id/fotos', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ project_id: string }>('SELECT project_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      return fotosNoLugar(c, p.project_id);
    });
  });

  app.get('/predios/:id/lazer', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return lazerDoPredio(c, id);
    });
  });

  /** Fotos prontas do projeto, para a gestão escolher as da ficha do lazer e da galeria (Plano 12b, itens 6 e 7). */
  app.get('/predios/:id/fotos-projeto', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ project_id: string }>('SELECT project_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      return fotosDoProjeto(c, p.project_id);
    });
  });

  /** A gestão marca o lazer clicando no 3D do prédio (a posição vem da cena). */
  app.post('/predios/:id/lazer', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = NovoLazer.parse(req.body);
    const item = await withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await conferirFotos(c, id, d.fotos ?? []);
      const n = (await c.query<{ n: number; proxima: number }>('SELECT count(*)::int AS n, coalesce(max(ordem) + 1, 0)::int AS proxima FROM lazer WHERE building_id = $1', [id])).rows[0]!;
      if (n.n >= MAX_LAZER) throw new ErroHttp(409, 'limite_lazer');
      const r = (
        await c.query<ItemLazer>(
          `INSERT INTO lazer (building_id, categoria, nome, descricao, x_m, y_m, z_m, ordem, fotos) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, categoria, nome, descricao, x_m AS x, y_m AS y, z_m AS z, ordem, fotos`,
          [id, d.categoria, d.nome, d.descricao ?? null, d.x, d.y, d.z, d.ordem ?? Math.min(1000, n.proxima), d.fotos ?? []],
        )
      ).rows[0]!;
      await registrarAuditoria(c, { userId: s.userId, acao: 'lazer.criar', entidade: 'lazer', entidadeId: r.id, depois: { predio: id, categoria: r.categoria, nome: r.nome } });
      return r;
    });
    return reply.status(201).send(item);
  });

  app.patch('/lazer/:id', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = EdicaoLazer.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      if (d.fotos !== undefined) {
        const predio = (await c.query<{ building_id: string }>('SELECT building_id FROM lazer WHERE id = $1', [id])).rows[0];
        if (!predio) throw new ErroHttp(404, 'nao_encontrado');
        await conferirFotos(c, predio.building_id, d.fotos);
      }
      const campos: Array<[string, unknown]> = [];
      if (d.categoria !== undefined) campos.push(['categoria', d.categoria]);
      if (d.nome !== undefined) campos.push(['nome', d.nome]);
      if (d.descricao !== undefined) campos.push(['descricao', d.descricao]);
      if (d.x !== undefined) campos.push(['x_m', d.x]);
      if (d.y !== undefined) campos.push(['y_m', d.y]);
      if (d.z !== undefined) campos.push(['z_m', d.z]);
      if (d.ordem !== undefined) campos.push(['ordem', d.ordem]);
      if (d.fotos !== undefined) campos.push(['fotos', d.fotos]);
      if (!campos.length) throw new ErroHttp(400, 'nada_para_mudar');
      const r = await c.query<ItemLazer>(
        `UPDATE lazer SET ${campos.map(([k], i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1
         RETURNING id, categoria, nome, descricao, x_m AS x, y_m AS y, z_m AS z, ordem, fotos`,
        [id, ...campos.map(([, v]) => v)],
      );
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await registrarAuditoria(c, { userId: s.userId, acao: 'lazer.editar', entidade: 'lazer', entidadeId: id, depois: d });
      return r.rows[0]!;
    });
  });

  app.delete('/lazer/:id', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    await withTenant(pool, ctx(s), async (c) => {
      const r = await c.query<{ nome: string }>('DELETE FROM lazer WHERE id = $1 RETURNING nome', [id]);
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await registrarAuditoria(c, { userId: s.userId, acao: 'lazer.remover', entidade: 'lazer', entidadeId: id, antes: { nome: r.rows[0]!.nome } });
    });
    return reply.status(204).send();
  });
}
