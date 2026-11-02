import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
}

const Visita = z.object({
  predioId: z.uuid(),
  cargaMs: z.number().int().min(0).max(600_000).nullable(),
  fpsMedio: z.number().min(0).max(500).nullable(),
  nivel: z.enum(['alto', 'medio', 'baixo']).nullable(),
  erros: z.number().int().min(0).max(1000).default(0),
  celular: z.boolean().default(false),
  /** O navegador tem WebGPU (adaptador de verdade, não só a API). */
  webgpu: z.boolean().nullable().default(null),
});
const Periodo = z.object({ dias: z.coerce.number().int().min(1).max(90).default(7) });
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

export function rotasTelemetria(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  /** Uma visita à Vitrine (enviada ao sair da página). Qualquer papel que vê o projeto pode registrar. */
  app.post('/telemetria/viewer', async (req, reply) => {
    const s = await exigir(req, 'projeto:ler');
    const v = Visita.parse(req.body);
    try {
      await withTenant(pool, ctx(s), (c) =>
        c.query('INSERT INTO telemetria_viewer (building_id, carga_ms, fps_medio, nivel, erros, celular, webgpu) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
          v.predioId,
          v.cargaMs,
          v.fpsMedio,
          v.nivel,
          v.erros,
          v.celular,
          v.webgpu,
        ]),
      );
    } catch (e) {
      // prédio inexistente ou de outra empresa (a chave composta recusa)
      if ((e as { code?: string }).code === '23503') throw new ErroHttp(404, 'nao_encontrado');
      throw e;
    }
    return reply.status(204).send();
  });

  /** Painel interno: como o 3D se comporta nos aparelhos reais das clientes. */
  app.get('/telemetria/viewer/resumo', async (req) => {
    const s = await exigir(req, 'auditoria:ler');
    const { dias } = Periodo.parse(req.query);
    return withTenant(pool, ctx(s), async (c) => {
      const r = await c.query<{
        sessoes: number;
        carga_p50: number | null;
        carga_p95: number | null;
        fps_p50: number | null;
        fps_p05: number | null;
        com_erro: number;
        alto: number;
        medio: number;
        baixo: number;
        celular: number;
        celular_fps_p50: number | null;
        webgpu: number;
        webgpu_medido: number;
      }>(
        `SELECT count(*)::int AS sessoes,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY carga_ms) AS carga_p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY carga_ms) AS carga_p95,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY fps_medio) AS fps_p50,
                percentile_cont(0.05) WITHIN GROUP (ORDER BY fps_medio) AS fps_p05,
                count(*) FILTER (WHERE erros > 0)::int AS com_erro,
                count(*) FILTER (WHERE nivel = 'alto')::int AS alto,
                count(*) FILTER (WHERE nivel = 'medio')::int AS medio,
                count(*) FILTER (WHERE nivel = 'baixo')::int AS baixo,
                count(*) FILTER (WHERE celular)::int AS celular,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY fps_medio) FILTER (WHERE celular) AS celular_fps_p50,
                count(*) FILTER (WHERE webgpu)::int AS webgpu,
                count(webgpu)::int AS webgpu_medido
           FROM telemetria_viewer
          WHERE criado_em > now() - make_interval(days => $1)`,
        [dias],
      );
      const x = r.rows[0]!;
      const arred = (n: number | null) => (n === null ? null : Math.round(Number(n) * 10) / 10);
      return {
        dias,
        sessoes: x.sessoes,
        cargaMs: { p50: arred(x.carga_p50), p95: arred(x.carga_p95) },
        fps: { p50: arred(x.fps_p50), p05: arred(x.fps_p05) },
        taxaErro: x.sessoes ? x.com_erro / x.sessoes : 0,
        porNivel: { alto: x.alto, medio: x.medio, baixo: x.baixo },
        celular: { sessoes: x.celular, fpsP50: arred(x.celular_fps_p50) },
        // parte das visitas (que mediram) com WebGPU: a decisão de migrar o 3D sai daqui
        webgpu: { visitas: x.webgpu, medidas: x.webgpu_medido },
      };
    });
  });
}
