import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import type { ServicosMapa } from '../mapa/osm';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
  mapa: ServicosMapa;
}

const CATEGORIAS = ['escola', 'saude', 'mercado', 'farmacia', 'transporte', 'parque', 'outro'] as const;
const Busca = z.object({ q: z.string().trim().min(5).max(200) });
const ImportarOsm = z.object({ raioM: z.number().int().min(200).max(3000).default(1000) });
const NovoPoi = z.object({ categoria: z.enum(CATEGORIAS), nome: z.string().trim().min(1).max(200), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
/** Velocidade média a pé para estimar o tempo (distância em linha reta). */
const METROS_POR_MINUTO = 80;
const MAX_POIS_OSM = 200;
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

async function localizacao(c: pg.PoolClient, projetoId: string): Promise<{ lat: number; lon: number } | null> {
  const r = await c.query<{ lat: number | null; lon: number | null }>('SELECT ST_Y(geom) AS lat, ST_X(geom) AS lon FROM projects WHERE id = $1', [projetoId]);
  if (!r.rows[0]) throw new ErroHttp(404, 'nao_encontrado');
  const { lat, lon } = r.rows[0];
  return lat === null || lon === null ? null : { lat, lon };
}

export function rotasMapa(app: FastifyInstance, { pool, exigir, mapa }: Dependencias): void {
  app.get('/geocodificar', async (req) => {
    await exigir(req, 'empreendimento:editar');
    const { q } = Busca.parse(req.query);
    try {
      return await mapa.buscarEndereco(q);
    } catch {
      throw new ErroHttp(502, 'servico_mapa_indisponivel');
    }
  });

  app.get('/projetos/:id/pois', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await localizacao(c, id))) return { semLocalizacao: true, pois: [] };
      const pois = (
        await c.query<{ distanciaM: number }>(
          `SELECT p.id, p.categoria, p.nome, p.origem, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon,
                  round(ST_Distance(p.geom::geography, pr.geom::geography))::int AS "distanciaM"
             FROM pois p JOIN projects pr ON pr.id = p.project_id
            WHERE p.project_id = $1 ORDER BY 7, p.nome`,
          [id],
        )
      ).rows;
      return { semLocalizacao: false, pois: pois.map((p) => ({ ...p, minutosAPe: Math.max(1, Math.ceil(p.distanciaM / METROS_POR_MINUTO)) })) };
    });
  });

  app.post('/projetos/:id/pois/osm', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const { raioM } = ImportarOsm.parse(req.body ?? {});
    const centro = await withTenant(pool, ctx(s), (c) => localizacao(c, id));
    if (!centro) throw new ErroHttp(400, 'sem_localizacao');
    let encontrados;
    try {
      encontrados = await mapa.buscarPois(centro.lat, centro.lon, raioM);
    } catch {
      throw new ErroHttp(502, 'servico_mapa_indisponivel');
    }
    const cosLat = Math.cos((centro.lat * Math.PI) / 180);
    const perto = encontrados
      .map((p) => ({ p, d: Math.hypot(p.lat - centro.lat, (p.lon - centro.lon) * cosLat) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_POIS_OSM)
      .map(({ p }) => p);
    return withTenant(pool, ctx(s), async (c) => {
      let novos = 0;
      for (const p of perto) {
        const r = await c.query<{ novo: boolean }>(
          `INSERT INTO pois (project_id, categoria, nome, geom, origem, osm_id)
           VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326), 'osm', $6)
           ON CONFLICT (project_id, osm_id) DO UPDATE SET categoria = EXCLUDED.categoria, nome = EXCLUDED.nome, geom = EXCLUDED.geom
           RETURNING (xmax = 0) AS novo`,
          [id, p.categoria, p.nome, p.lat, p.lon, p.osmId],
        );
        if (r.rows[0]!.novo) novos++;
      }
      await registrarAuditoria(c, { userId: s.userId, acao: 'pois.importar_osm', entidade: 'project', entidadeId: id, depois: { raioM, encontrados: perto.length, novos } });
      return { encontrados: perto.length, novos };
    });
  });

  app.post('/projetos/:id/pois', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const p = NovoPoi.parse(req.body);
    const novo = await withTenant(pool, ctx(s), async (c) => {
      await localizacao(c, id);
      return (
        await c.query<{ id: string }>(
          "INSERT INTO pois (project_id, categoria, nome, geom, origem) VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326), 'manual') RETURNING id",
          [id, p.categoria, p.nome, p.lat, p.lon],
        )
      ).rows[0]!;
    });
    return reply.status(201).send(novo);
  });

  app.delete('/pois/:id', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const apagado = await withTenant(pool, ctx(s), async (c) => (await c.query('DELETE FROM pois WHERE id = $1', [id])).rowCount);
    if (!apagado) throw new ErroHttp(404, 'nao_encontrado');
    return reply.status(204).send();
  });
}
