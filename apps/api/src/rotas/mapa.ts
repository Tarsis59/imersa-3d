import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import type { PredioOsm, ServicosMapa } from '../mapa/osm';

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

/** Raio do entorno em volta do empreendimento. */
const RAIO_ENTORNO_M = 500;
/** Se o projeto mudou de lugar mais que isso, o cache do entorno não vale mais. */
const DESVIO_MAX_CACHE_M = 50;
const ATRIBUICAO_OSM = '© colaboradores do OpenStreetMap (ODbL)';

export function rotasMapa(app: FastifyInstance, { pool, exigir, mapa }: Dependencias): void {
  async function buscarPredios(centro: { lat: number; lon: number }): Promise<PredioOsm[]> {
    try {
      return await mapa.buscarPredios(centro.lat, centro.lon, RAIO_ENTORNO_M);
    } catch {
      throw new ErroHttp(502, 'servico_mapa_indisponivel');
    }
  }
  const gravarEntorno = (c: pg.PoolClient, id: string, centro: { lat: number; lon: number }, predios: PredioOsm[]) =>
    c.query(
      `INSERT INTO entornos (project_id, centro, raio_m, predios) VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, $5::jsonb)
       ON CONFLICT (project_id) DO UPDATE SET centro = EXCLUDED.centro, raio_m = EXCLUDED.raio_m, predios = EXCLUDED.predios, atualizado_em = now()`,
      [id, centro.lat, centro.lon, RAIO_ENTORNO_M, JSON.stringify(predios)],
    );

  app.get('/projetos/:id/entorno', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    const { centro, cache } = await withTenant(pool, ctx(s), async (c) => {
      const centro = await localizacao(c, id);
      if (!centro) return { centro, cache: undefined };
      const r = await c.query<{ predios: PredioOsm[]; atualizadoEm: Date; desvio: number; raio: number }>(
        `SELECT e.predios, e.atualizado_em AS "atualizadoEm", e.raio_m AS raio, ST_Distance(e.centro::geography, p.geom::geography) AS desvio
           FROM entornos e JOIN projects p ON p.id = e.project_id WHERE e.project_id = $1`,
        [id],
      );
      return { centro, cache: r.rows[0] };
    });
    if (!centro) return { semLocalizacao: true, centro: null, predios: [], atualizadoEm: null, atribuicao: ATRIBUICAO_OSM };
    if (cache && cache.raio === RAIO_ENTORNO_M && cache.desvio <= DESVIO_MAX_CACHE_M) {
      return { semLocalizacao: false, centro, predios: cache.predios, atualizadoEm: cache.atualizadoEm, atribuicao: ATRIBUICAO_OSM };
    }
    const predios = await buscarPredios(centro);
    await withTenant(pool, ctx(s), (c) => gravarEntorno(c, id, centro, predios));
    return { semLocalizacao: false, centro, predios, atualizadoEm: new Date(), atribuicao: ATRIBUICAO_OSM };
  });

  app.post('/projetos/:id/entorno/atualizar', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const centro = await withTenant(pool, ctx(s), (c) => localizacao(c, id));
    if (!centro) throw new ErroHttp(400, 'sem_localizacao');
    const predios = await buscarPredios(centro);
    await withTenant(pool, ctx(s), async (c) => {
      await gravarEntorno(c, id, centro, predios);
      await registrarAuditoria(c, { userId: s.userId, acao: 'entorno.atualizar', entidade: 'project', entidadeId: id, depois: { predios: predios.length } });
    });
    return { predios: predios.length };
  });

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
