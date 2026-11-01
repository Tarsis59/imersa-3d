import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import { FORMATOS_VIDEO } from '../videos/worker';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
}

const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });
const NovoVideo = z.object({ formato: z.enum(FORMATOS_VIDEO) });

/** Estúdio de marketing: vídeos do prédio (Blender, fiel ao projeto, com selo) e a biblioteca de mídia. */
export function rotasVideos(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  app.post('/predios/:id/videos', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const { formato } = NovoVideo.parse(req.body);
    const novo = await withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ modelo_asset_id: string | null }>('SELECT modelo_asset_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      if (!p.modelo_asset_id) throw new ErroHttp(409, 'predio_sem_modelo');
      try {
        const r = (await c.query<{ id: string }>('INSERT INTO videos (building_id, modelo_asset_id, formato) VALUES ($1, $2, $3) RETURNING id', [id, p.modelo_asset_id, formato])).rows[0]!;
        await registrarAuditoria(c, { userId: s.userId, acao: 'video.pedir', entidade: 'video', entidadeId: r.id, depois: { predio: id, formato } });
        return r;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ErroHttp(409, 'video_em_andamento');
        throw e;
      }
    });
    return reply.status(201).send(novo);
  });

  /** Biblioteca: os vídeos do prédio (mais novos primeiro), com o MP4 e a capa para baixar. */
  app.get('/predios/:id/videos', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ modelo_asset_id: string | null }>('SELECT modelo_asset_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      const videos = (
        await c.query(
          `SELECT v.id, v.formato, v.status, v.mensagem, v.metricas, v.video_asset_id AS "arquivoId", v.capa_asset_id AS "capaId",
                  v.criado_em AS "criadoEm", v.atualizado_em AS "atualizadoEm", v.modelo_asset_id = b.modelo_asset_id AS atual
             FROM videos v JOIN buildings b ON b.id = v.building_id WHERE v.building_id = $1 ORDER BY v.criado_em DESC LIMIT 30`,
          [id],
        )
      ).rows;
      return { temModelo: p.modelo_asset_id !== null, videos };
    });
  });
}
