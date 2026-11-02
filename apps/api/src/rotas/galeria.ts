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

/** Galeria do empreendimento (Plano 12b, item 7): drone, renders e fotos; limite generoso, mas finito. */
export const MAX_GALERIA = 60;
const Galeria = z.object({ fotos: z.array(z.uuid()).max(MAX_GALERIA) });
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

export interface FotoDaGaleria {
  id: string;
  nome: string;
}

/** Galeria do prédio, na ordem da gestão (o portal do cliente e o estande usam a mesma lista). */
export async function galeriaDoPredio(c: pg.PoolClient, predioId: string): Promise<FotoDaGaleria[]> {
  return (
    await c.query<FotoDaGaleria>(
      `SELECT a.id, a.nome FROM galeria_fotos g JOIN assets a ON a.id = g.asset_id
        WHERE g.building_id = $1 ORDER BY g.ordem`,
      [predioId],
    )
  ).rows;
}

export function rotasGaleria(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  app.get('/predios/:id/galeria', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return galeriaDoPredio(c, id);
    });
  });

  /** A gestão escolhe as fotos do projeto que entram na galeria e a ordem (a lista inteira é substituída). */
  app.put('/predios/:id/galeria', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = Galeria.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ project_id: string }>('SELECT project_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      if (d.fotos.length) {
        const r = await c.query<{ id: string }>(
          "SELECT id FROM assets WHERE project_id = $1 AND status = 'pronto' AND tipo = 'imagem' AND id = ANY($2::uuid[])",
          [p.project_id, d.fotos],
        );
        if (r.rowCount !== d.fotos.length) throw new ErroHttp(400, 'foto_invalida');
      }
      await c.query('DELETE FROM galeria_fotos WHERE building_id = $1', [id]);
      for (let i = 0; i < d.fotos.length; i++) {
        await c.query('INSERT INTO galeria_fotos (building_id, asset_id, ordem) VALUES ($1, $2, $3)', [id, d.fotos[i], i]);
      }
      await registrarAuditoria(c, { userId: s.userId, acao: 'galeria.editar', entidade: 'building', entidadeId: id, depois: { fotos: d.fotos.length } });
      return galeriaDoPredio(c, id);
    });
  });
}
