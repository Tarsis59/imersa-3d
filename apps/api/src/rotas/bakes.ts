import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
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

/**
 * GLB "assado" que a Vitrine abre: o último bake pronto feito com o modelo que o prédio usa hoje (Plano 12a,
 * item 6). Trocar o modelo do prédio deixa o bake desatualizado e pede um novo.
 */
export async function bakeDaVitrine(c: pg.PoolClient, predioId: string): Promise<{ arquivoId: string } | null> {
  return (
    (
      await c.query<{ arquivoId: string }>(
        `SELECT bk.glb_asset_id AS "arquivoId" FROM bakes bk JOIN buildings b ON b.id = bk.building_id
          WHERE bk.building_id = $1 AND bk.status = 'pronto' AND bk.glb_asset_id IS NOT NULL AND bk.modelo_asset_id = b.modelo_asset_id
          ORDER BY bk.criado_em DESC LIMIT 1`,
        [predioId],
      )
    ).rows[0] ?? null
  );
}

export function rotasBakes(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  /** Pede o bake da luz (dia e noite) do modelo atual do prédio (Blender Cycles na GPU gratuita do Kaggle). */
  app.post('/predios/:id/bakes', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const novo = await withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ modelo_asset_id: string | null }>('SELECT modelo_asset_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      if (!p.modelo_asset_id) throw new ErroHttp(409, 'predio_sem_modelo');
      try {
        const r = (await c.query<{ id: string }>('INSERT INTO bakes (building_id, modelo_asset_id) VALUES ($1, $2) RETURNING id', [id, p.modelo_asset_id])).rows[0]!;
        await registrarAuditoria(c, { userId: s.userId, acao: 'bake.pedir', entidade: 'bake', entidadeId: r.id, depois: { predio: id, modelo: p.modelo_asset_id } });
        return r;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ErroHttp(409, 'bake_em_andamento');
        throw e;
      }
    });
    return reply.status(201).send(novo);
  });

  /**
   * Último bake do prédio e o último pronto (o que a Vitrine abre). `atual`: feito com o modelo que o prédio
   * usa hoje (trocar o modelo pede um bake novo).
   */
  app.get('/predios/:id/bakes', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ modelo_asset_id: string | null }>('SELECT modelo_asset_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      const campos = `bk.id, bk.status, bk.mensagem, bk.metricas, bk.glb_asset_id AS "arquivoId", bk.criado_em AS "criadoEm",
                      bk.atualizado_em AS "atualizadoEm", bk.modelo_asset_id = b.modelo_asset_id AS atual`;
      const ultimo = (await c.query(`SELECT ${campos} FROM bakes bk JOIN buildings b ON b.id = bk.building_id WHERE bk.building_id = $1 ORDER BY bk.criado_em DESC LIMIT 1`, [id])).rows[0] ?? null;
      const pronto =
        (
          await c.query(
            `SELECT ${campos} FROM bakes bk JOIN buildings b ON b.id = bk.building_id
              WHERE bk.building_id = $1 AND bk.status = 'pronto' AND bk.glb_asset_id IS NOT NULL ORDER BY bk.criado_em DESC LIMIT 1`,
            [id],
          )
        ).rows[0] ?? null;
      return { temModelo: p.modelo_asset_id !== null, ultimo, pronto, vitrine: await bakeDaVitrine(c, id) };
    });
  });
}
