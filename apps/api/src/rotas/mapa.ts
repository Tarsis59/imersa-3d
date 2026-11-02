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
import { distanciasAPe, rotaAPe, type Area, type Via } from '../mapa/malha';
import type { Relevo } from '../mapa/relevo';

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
/** Com o relevo, os dados abertos do Terrain Tiles também são citados. */
const ATRIBUICAO_COMPLETA = `${ATRIBUICAO_OSM} · relevo: Terrain Tiles (AWS Open Data)`;
/** Ruas, verde e relevo vão um pouco além dos prédios (o chão chega ao horizonte da neblina). */
const RAIO_CIDADE_M = 600;
const REPETIR_RELEVO_H = 6;
/** Ruas e verde que não vieram (o mapa público cheio): tenta de novo depois disso, sem travar cada visita. */
const REPETIR_MALHA_MIN = 10;

type Contexto = { tenantId: string; userId: string | null };

/** Entorno do projeto (cache no banco; consulta o OSM quando falta ou o projeto mudou de lugar). Usado pelo painel e pelo portal público. */
export function criarEntorno(pool: pg.Pool, mapa: ServicosMapa) {
  async function buscarPredios(centro: { lat: number; lon: number }): Promise<PredioOsm[]> {
    try {
      return await mapa.buscarPredios(centro.lat, centro.lon, RAIO_ENTORNO_M);
    } catch {
      throw new ErroHttp(502, 'servico_mapa_indisponivel');
    }
  }
  /**
   * Ruas, verde, água e relevo: nunca derrubam o entorno (sem eles, a cidade fica só com os prédios num chão plano).
   * Falha da malha fica null ("não sei ainda", diferente de lista vazia = "não há ruas aqui") e é tentada de novo
   * depois de `REPETIR_MALHA_MIN`; falha do relevo fica null e é tentada de novo depois de `REPETIR_RELEVO_H`.
   */
  async function buscarCidade(centro: { lat: number; lon: number }): Promise<{ vias: Via[] | null; areas: Area[] | null; relevo: Relevo | null }> {
    const [malha, relevo] = await Promise.all([
      mapa.buscarMalha ? mapa.buscarMalha(centro.lat, centro.lon, RAIO_CIDADE_M).catch(() => null) : Promise.resolve(null),
      mapa.buscarRelevo ? mapa.buscarRelevo(centro.lat, centro.lon, RAIO_CIDADE_M).catch(() => null) : Promise.resolve(null),
    ]);
    return { vias: malha?.vias ?? null, areas: malha?.areas ?? null, relevo };
  }
  const gravar = (c: pg.PoolClient, id: string, centro: { lat: number; lon: number }, predios: PredioOsm[], cidade?: { vias: Via[] | null; areas: Area[] | null; relevo: Relevo | null }) =>
    c.query(
      `INSERT INTO entornos (project_id, centro, raio_m, predios, vias, areas, relevo) VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
       ON CONFLICT (project_id) DO UPDATE SET centro = EXCLUDED.centro, raio_m = EXCLUDED.raio_m, predios = EXCLUDED.predios,
         vias = coalesce(EXCLUDED.vias, entornos.vias), areas = coalesce(EXCLUDED.areas, entornos.areas), relevo = coalesce(EXCLUDED.relevo, entornos.relevo), atualizado_em = now()`,
      [
        id,
        centro.lat,
        centro.lon,
        RAIO_ENTORNO_M,
        JSON.stringify(predios),
        cidade?.vias ? JSON.stringify(cidade.vias) : null,
        cidade?.areas ? JSON.stringify(cidade.areas) : null,
        cidade?.relevo ? JSON.stringify(cidade.relevo) : null,
      ],
    );

  async function obter(contexto: Contexto, id: string) {
    const { centro, cache } = await withTenant(pool, contexto, async (c) => {
      const centro = await localizacao(c, id);
      if (!centro) return { centro, cache: undefined };
      const r = await c.query<{ predios: PredioOsm[]; vias: Via[] | null; areas: Area[] | null; relevo: Relevo | null; atualizadoEm: Date; desvio: number; raio: number }>(
        `SELECT e.predios, e.vias, e.areas, e.relevo, e.atualizado_em AS "atualizadoEm", e.raio_m AS raio, ST_Distance(e.centro::geography, p.geom::geography) AS desvio
           FROM entornos e JOIN projects p ON p.id = e.project_id WHERE e.project_id = $1`,
        [id],
      );
      return { centro, cache: r.rows[0] };
    });
    if (!centro) return { semLocalizacao: true, centro: null, predios: [], vias: [], areas: [], relevo: null, atualizadoEm: null, atribuicao: ATRIBUICAO_OSM };
    if (cache && cache.raio === RAIO_ENTORNO_M && cache.desvio <= DESVIO_MAX_CACHE_M) {
      let { vias, areas, relevo } = cache;
      // cache de antes da cidade completa (ou relevo que falhou há tempo): completa agora, sem refazer os prédios
      const idadeMs = Date.now() - new Date(cache.atualizadoEm).getTime();
      if ((vias === null && idadeMs > REPETIR_MALHA_MIN * 60_000) || (relevo === null && idadeMs > REPETIR_RELEVO_H * 3_600_000)) {
        const cidade = await buscarCidade(centro);
        vias = vias ?? cidade.vias;
        areas = areas ?? cidade.areas;
        relevo = relevo ?? cidade.relevo;
        await withTenant(pool, contexto, (c) => gravar(c, id, centro, cache.predios, { vias, areas, relevo }));
      }
      return { semLocalizacao: false, centro, predios: cache.predios, vias: vias ?? [], areas: areas ?? [], relevo, atualizadoEm: cache.atualizadoEm, atribuicao: ATRIBUICAO_COMPLETA };
    }
    const [predios, cidade] = await Promise.all([buscarPredios(centro), buscarCidade(centro)]);
    await withTenant(pool, contexto, (c) => gravar(c, id, centro, predios, cidade));
    return { semLocalizacao: false, centro, predios, vias: cidade.vias ?? [], areas: cidade.areas ?? [], relevo: cidade.relevo, atualizadoEm: new Date(), atribuicao: ATRIBUICAO_COMPLETA };
  }

  return { obter, buscarPredios, buscarCidade, gravar };
}

const IdPoi = z.object({ id: z.uuid(), poiId: z.uuid() });

/** Escolas, mercados, metrô... do projeto, os mais perto a pé primeiro (painel, link do cliente e IA). */
export async function poisDoProjeto(c: pg.PoolClient, projetoId: string) {
  const geo = (await c.query<{ tem: boolean }>('SELECT geom IS NOT NULL AS tem FROM projects WHERE id = $1', [projetoId])).rows[0];
  if (!geo?.tem) return { semLocalizacao: true, pois: [] };
  const pois = (
    await c.query<{ id: string; categoria: string; nome: string; origem: string; lat: number; lon: number; distanciaM: number; caminhoM: number | null }>(
      `SELECT p.id, p.categoria, p.nome, p.origem, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon,
              round(ST_Distance(p.geom::geography, pr.geom::geography))::int AS "distanciaM", p.caminho_m AS "caminhoM"
         FROM pois p JOIN projects pr ON pr.id = p.project_id
        WHERE p.project_id = $1 ORDER BY coalesce(p.caminho_m, round(ST_Distance(p.geom::geography, pr.geom::geography))), p.nome`,
      [projetoId],
    )
  ).rows;
  // a pé pelas ruas quando dá para calcular; senão, linha reta
  return { semLocalizacao: false, pois: pois.map((p) => ({ ...p, minutosAPe: Math.max(1, Math.ceil((p.caminhoM ?? p.distanciaM) / METROS_POR_MINUTO)) })) };
}

/**
 * Rota a pé do empreendimento até o ponto, pelas ruas do entorno guardado. `undefined` = o ponto não é deste projeto;
 * `null` = sem ruas em volta (o 3D mostra só a distância em linha reta).
 */
export async function rotaDoPoi(c: pg.PoolClient, projetoId: string, poiId: string) {
  const r = (
    await c.query<{ lat: number; lon: number; plat: number | null; plon: number | null; vias: Via[] | null }>(
      `SELECT ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon, ST_Y(pr.geom) AS plat, ST_X(pr.geom) AS plon, e.vias
         FROM pois p JOIN projects pr ON pr.id = p.project_id LEFT JOIN entornos e ON e.project_id = pr.id
        WHERE p.id = $1 AND p.project_id = $2`,
      [poiId, projetoId],
    )
  ).rows[0];
  if (!r) return undefined;
  if (r.plat === null || r.plon === null || !r.vias?.length) return null;
  const rota = rotaAPe(r.vias, { lat: r.plat, lon: r.plon }, { lat: r.lat, lon: r.lon });
  return rota ? { ...rota, minutosAPe: Math.max(1, Math.ceil(rota.metros / METROS_POR_MINUTO)) } : null;
}

/**
 * Tempo a pé pelo desenho das ruas (Plano 11b, item 8): com as ruas do entorno em cache, cada ponto ganha a distância
 * andando de verdade (quarteirão, travessia), não em linha reta. Sem ruas, fica null e a tela usa a linha reta.
 */
export async function atualizarCaminhos(c: pg.PoolClient, projetoId: string): Promise<number> {
  const e = (await c.query<{ vias: Via[] | null; lat: number; lon: number }>('SELECT e.vias, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon FROM entornos e JOIN projects p ON p.id = e.project_id WHERE e.project_id = $1 AND p.geom IS NOT NULL', [projetoId])).rows[0];
  if (!e?.vias?.length) return 0;
  const pois = (await c.query<{ id: string; lat: number; lon: number }>('SELECT id, ST_Y(geom) AS lat, ST_X(geom) AS lon FROM pois WHERE project_id = $1', [projetoId])).rows;
  if (!pois.length) return 0;
  const d = distanciasAPe(e.vias, { lat: e.lat, lon: e.lon }, pois);
  await c.query('UPDATE pois p SET caminho_m = x.m FROM unnest($1::uuid[], $2::int[]) AS x(id, m) WHERE p.id = x.id', [pois.map((p) => p.id), d]);
  return d.filter((x) => x !== null).length;
}

/** Escolas, mercados, metrô... do OSM em volta do projeto (os mais perto primeiro). Usado pela tela e pela criação integrada. */
export async function importarPoisOsm(pool: pg.Pool, mapa: ServicosMapa, contexto: Contexto, id: string, raioM: number): Promise<{ encontrados: number; novos: number }> {
  const centro = await withTenant(pool, contexto, (c) => localizacao(c, id));
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
  return withTenant(pool, contexto, async (c) => {
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
    const aPe = await atualizarCaminhos(c, id);
    await registrarAuditoria(c, { userId: contexto.userId, acao: 'pois.importar_osm', entidade: 'project', entidadeId: id, depois: { raioM, encontrados: perto.length, novos, aPe } });
    return { encontrados: perto.length, novos };
  });
}

export function rotasMapa(app: FastifyInstance, { pool, exigir, mapa }: Dependencias): void {
  const entorno = criarEntorno(pool, mapa);

  app.get('/projetos/:id/entorno', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return entorno.obter(ctx(s), id);
  });

  app.post('/projetos/:id/entorno/atualizar', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const centro = await withTenant(pool, ctx(s), (c) => localizacao(c, id));
    if (!centro) throw new ErroHttp(400, 'sem_localizacao');
    const [predios, cidade] = await Promise.all([entorno.buscarPredios(centro), entorno.buscarCidade(centro)]);
    await withTenant(pool, ctx(s), async (c) => {
      await entorno.gravar(c, id, centro, predios, cidade);
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
      await localizacao(c, id); // projeto de outra empresa (ou inexistente): 404
      return poisDoProjeto(c, id);
    });
  });

  /** A rota a pé desenhada até um ponto (Plano 12a, item 11). */
  app.get('/projetos/:id/pois/:poiId/rota', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id, poiId } = IdPoi.parse(req.params);
    const r = await withTenant(pool, ctx(s), (c) => rotaDoPoi(c, id, poiId));
    if (r === undefined) throw new ErroHttp(404, 'nao_encontrado');
    return { rota: r };
  });

  app.post('/projetos/:id/pois/osm', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const { raioM } = ImportarOsm.parse(req.body ?? {});
    return importarPoisOsm(pool, mapa, ctx(s), id, raioM);
  });

  app.post('/projetos/:id/pois', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const p = NovoPoi.parse(req.body);
    const novo = await withTenant(pool, ctx(s), async (c) => {
      await localizacao(c, id);
      const r = (
        await c.query<{ id: string }>(
          "INSERT INTO pois (project_id, categoria, nome, geom, origem) VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326), 'manual') RETURNING id",
          [id, p.categoria, p.nome, p.lat, p.lon],
        )
      ).rows[0]!;
      await atualizarCaminhos(c, id);
      return r;
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
