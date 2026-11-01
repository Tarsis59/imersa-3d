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
 * Giro que a Vitrine abre (painel e portal do comprador): o último pronto feito com o modelo que o prédio usa hoje.
 * Vínculos de unidade mudados depois não atrapalham: `unidades` guarda quem era cada cor-ID no render.
 */
export async function giroDaVitrine(c: pg.PoolClient, predioId: string): Promise<{ arquivoId: string; unidades: string[] } | null> {
  return (
    (
      await c.query<{ arquivoId: string; unidades: string[] }>(
        `SELECT g.zip_asset_id AS "arquivoId", g.unidades FROM giros g JOIN buildings b ON b.id = g.building_id
          WHERE g.building_id = $1 AND g.status = 'pronto' AND g.zip_asset_id IS NOT NULL AND g.modelo_asset_id = b.modelo_asset_id
          ORDER BY g.criado_em DESC LIMIT 1`,
        [predioId],
      )
    ).rows[0] ?? null
  );
}

export function rotasGiros(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  /** Pede o giro 360° fotorrealista do modelo atual do prédio (Blender Cycles na GPU gratuita do Kaggle). */
  app.post('/predios/:id/giros', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const novo = await withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ modelo_asset_id: string | null }>('SELECT modelo_asset_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      if (!p.modelo_asset_id) throw new ErroHttp(409, 'predio_sem_modelo');
      try {
        const r = (await c.query<{ id: string }>('INSERT INTO giros (building_id, modelo_asset_id) VALUES ($1, $2) RETURNING id', [id, p.modelo_asset_id])).rows[0]!;
        await registrarAuditoria(c, { userId: s.userId, acao: 'giro.pedir', entidade: 'giro', entidadeId: r.id, depois: { predio: id, modelo: p.modelo_asset_id } });
        return r;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ErroHttp(409, 'giro_em_andamento');
        throw e;
      }
    });
    return reply.status(201).send(novo);
  });

  /**
   * Último giro do prédio e o último pronto (o que a Vitrine abre). `atual`: feito com o modelo que o prédio usa
   * hoje e com as mesmas unidades ligadas (trocar o modelo ou os vínculos pede um giro novo).
   */
  app.get('/predios/:id/giros', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ modelo_asset_id: string | null }>('SELECT modelo_asset_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      const campos = `g.id, g.status, g.mensagem, g.quadros, g.unidades, g.metricas, g.zip_asset_id AS "arquivoId", g.criado_em AS "criadoEm",
                      g.atualizado_em AS "atualizadoEm", g.modelo_asset_id = b.modelo_asset_id
                        AND g.unidades = coalesce((SELECT jsonb_agg(u.id ORDER BY u.id) FROM units u WHERE u.building_id = b.id AND u.mesh_node_id IS NOT NULL), '[]') AS atual`;
      const ultimo = (await c.query(`SELECT ${campos} FROM giros g JOIN buildings b ON b.id = g.building_id WHERE g.building_id = $1 ORDER BY g.criado_em DESC LIMIT 1`, [id])).rows[0] ?? null;
      const pronto =
        (
          await c.query(
            `SELECT ${campos} FROM giros g JOIN buildings b ON b.id = g.building_id
              WHERE g.building_id = $1 AND g.status = 'pronto' AND g.zip_asset_id IS NOT NULL ORDER BY g.criado_em DESC LIMIT 1`,
            [id],
          )
        ).rows[0] ?? null;
      return { temModelo: p.modelo_asset_id !== null, ultimo, pronto, vitrine: await giroDaVitrine(c, id) };
    });
  });
}
