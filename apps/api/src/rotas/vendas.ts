import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import { ehGestao, type Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { hashToken } from '../auth/hash';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
  webUrl: string;
}

export const STATUS_LEAD = ['novo', 'em_contato', 'convertido', 'descartado'] as const;
const Ponto = z.tuple([z.number().finite().min(-10_000).max(10_000), z.number().finite().min(-10_000).max(10_000), z.number().finite().min(-10_000).max(10_000)]);
/** Câmera da consultora no tour guiado ao vivo. */
const Conducao = z.object({ ativo: z.boolean(), posicao: Ponto.optional(), alvo: Ponto.optional(), unidade: z.uuid().nullable().optional() });
/** WhatsApp do corretor: aceita "(11) 98888-7777" ou "+55 11 98888-7777"; guarda só dígitos com o 55 na frente. */
const WhatsappBr = z
  .string()
  // com "+" na frente o código do país já veio (só vale o +55); sem ele, DDD + número ganha o 55
  .transform((v) => {
    const digitos = v.replace(/\D/g, '');
    if (v.trim().startsWith('+')) return digitos;
    return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
  })
  .refine((v) => /^55[1-9][0-9]{9,10}$/.test(v), 'WhatsApp com DDD, ex.: (11) 98888-7777');
const NovoLink = z.object({
  titulo: z.string().trim().min(1).max(120).optional(),
  dias: z.number().int().min(1).max(90).default(30),
  whatsapp: WhatsappBr.optional(),
});
const MudarLead = z.object({ status: z.enum(STATUS_LEAD) });
const FiltroLeads = z.object({ projetoId: z.uuid().optional(), status: z.enum(STATUS_LEAD).optional() });
const Periodo = z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) });
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

/** Consultora só enxerga o que é dela (links que criou e os leads deles); a gestão vê tudo da empresa. */
const soDela = (s: Sessao) => (ehGestao(s.papel) ? null : s.userId);

export function rotasVendas(app: FastifyInstance, { pool, exigir, webUrl }: Dependencias): void {
  app.post('/predios/:id/links', async (req, reply) => {
    const s = await exigir(req, 'link:criar');
    const { id } = IdParam.parse(req.params);
    const d = NovoLink.parse(req.body ?? {});
    // 256 bits aleatórios; o banco guarda só o hash
    const token = randomBytes(32).toString('base64url');
    const criado = await withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      const r = await c.query<{ id: string; expira_em: Date }>(
        'INSERT INTO share_links (building_id, token_hash, titulo, criado_por, expira_em, whatsapp) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6) RETURNING id, expira_em',
        [id, hashToken(token), d.titulo ?? null, s.userId, d.dias, d.whatsapp ?? null],
      );
      const l = r.rows[0]!;
      await registrarAuditoria(c, { userId: s.userId, acao: 'link.criar', entidade: 'share_link', entidadeId: l.id, depois: { predio: id, dias: d.dias, titulo: d.titulo } });
      return l;
    });
    return reply.status(201).send({ id: criado.id, url: `${webUrl}/v/${token}`, expiraEm: criado.expira_em });
  });

  app.get('/predios/:id/links', async (req) => {
    const s = await exigir(req, 'link:criar');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      const r = await c.query(
        `SELECT l.id, l.titulo, l.expira_em AS "expiraEm", l.revogado_em AS "revogadoEm", l.criado_em AS "criadoEm",
                json_build_object('id', u.id, 'nome', u.nome) AS "criadoPor",
                CASE WHEN l.revogado_em IS NOT NULL THEN 'revogado' WHEN l.expira_em <= now() THEN 'vencido' ELSE 'ativo' END AS status,
                (SELECT count(*)::int FROM view_events e WHERE e.link_id = l.id AND e.tipo = 'abriu') AS visitas,
                (SELECT count(*)::int FROM leads x WHERE x.link_id = l.id) AS leads
           FROM share_links l JOIN users u ON u.id = l.criado_por
          WHERE l.building_id = $1 AND l.tipo = 'cliente' AND ($2::uuid IS NULL OR l.criado_por = $2)
          ORDER BY l.criado_em DESC`,
        [id, soDela(s)],
      );
      return r.rows;
    });
  });

  app.post('/links/:id/revogar', async (req) => {
    const s = await exigir(req, 'link:criar');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const r = await c.query('UPDATE share_links SET revogado_em = coalesce(revogado_em, now()) WHERE id = $1 AND ($2::uuid IS NULL OR criado_por = $2) RETURNING id', [id, soDela(s)]);
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await registrarAuditoria(c, { userId: s.userId, acao: 'link.revogar', entidade: 'share_link', entidadeId: id });
      return { status: 'revogado' };
    });
  });

  /**
   * Tour guiado ao vivo: a consultora conduz e a câmera do cliente (no portal do link) segue a dela. A posição vai pelo
   * mesmo canal do status ao vivo (NOTIFY), só para quem assiste aquele link. Várias vezes por segundo: limite alto.
   */
  app.post('/links/:id/conducao', { config: { rateLimit: { max: 900, timeWindow: '1 minute' } }, bodyLimit: 2048 }, async (req, reply) => {
    const s = await exigir(req, 'link:criar');
    const { id } = IdParam.parse(req.params);
    const d = Conducao.parse(req.body);
    await withTenant(pool, ctx(s), async (c) => {
      const r = await c.query(
        "SELECT 1 FROM share_links WHERE id = $1 AND tipo = 'cliente' AND revogado_em IS NULL AND expira_em > now() AND ($2::uuid IS NULL OR criado_por = $2)",
        [id, soDela(s)],
      );
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await c.query('SELECT pg_notify($1, $2)', ['imersa_conducao', JSON.stringify({ t: s.tenantId, l: id, ...d })]);
    });
    return reply.status(204).send();
  });

  app.get('/leads', async (req) => {
    const s = await exigir(req, 'lead:ler');
    const f = FiltroLeads.parse(req.query);
    return withTenant(pool, ctx(s), async (c) =>
      (
        await c.query(
          `SELECT x.id, x.nome, x.telefone, x.email, x.mensagem, x.status, x.criado_em AS "criadoEm",
                  un.codigo AS unidade, ('lote ' || lt.numero || ' da quadra ' || lt.quadra) AS lote,
                  b.nome AS predio, b.id AS "predioId", p.nome AS projeto, p.id AS "projetoId",
                  u.nome AS consultora, l.titulo AS link,
                  temperatura_do_link(x.link_id) AS temperatura,
                  coalesce((SELECT array_agg(DISTINCT e.missao ORDER BY e.missao) FROM view_events e
                             WHERE e.link_id = x.link_id AND e.tipo = 'missao' AND e.criado_em > now() - interval '30 days'), '{}') AS missoes
             FROM leads x
             JOIN share_links l ON l.id = x.link_id
             JOIN users u ON u.id = l.criado_por
             JOIN buildings b ON b.id = l.building_id
             JOIN projects p ON p.id = b.project_id
             LEFT JOIN units un ON un.id = x.unit_id
             LEFT JOIN lotes lt ON lt.id = x.lote_id
            WHERE ($1::uuid IS NULL OR l.criado_por = $1) AND ($2::uuid IS NULL OR p.id = $2) AND ($3::text IS NULL OR x.status = $3)
            ORDER BY x.criado_em DESC
            LIMIT 500`,
          [soDela(s), f.projetoId ?? null, f.status ?? null],
        )
      ).rows,
    );
  });

  app.patch('/leads/:id', async (req) => {
    const s = await exigir(req, 'lead:ler');
    const { id } = IdParam.parse(req.params);
    const d = MudarLead.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      const r = await c.query<{ antes: string }>(
        `UPDATE leads x SET status = $2 FROM share_links l, leads velho
          WHERE x.id = $1 AND velho.id = x.id AND l.id = x.link_id AND ($3::uuid IS NULL OR l.criado_por = $3)
          RETURNING velho.status AS antes`,
        [id, d.status, soDela(s)],
      );
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await registrarAuditoria(c, { userId: s.userId, acao: 'lead.status', entidade: 'lead', entidadeId: id, antes: { status: r.rows[0]!.antes }, depois: { status: d.status } });
      return { id, status: d.status };
    });
  });

  /** Números do empreendimento: tudo calculado dos eventos brutos (sem tabela de totais que possa divergir). */
  app.get('/projetos/:id/numeros', async (req) => {
    const s = await exigir(req, 'numeros:ler');
    const { id } = IdParam.parse(req.params);
    const { dias } = Periodo.parse(req.query);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM projects WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      const dela = soDela(s);
      // links do empreendimento (da consultora, se for ela) + eventos e leads do período
      const base = `WITH lk AS (
          SELECT l.id, l.criado_por FROM share_links l JOIN buildings b ON b.id = l.building_id
           WHERE b.project_id = $1 AND ($2::uuid IS NULL OR l.criado_por = $2)
        ), ev AS (
          SELECT e.* FROM view_events e JOIN lk ON lk.id = e.link_id WHERE e.criado_em > now() - make_interval(days => $3)
        ), ld AS (
          SELECT x.* FROM leads x JOIN lk ON lk.id = x.link_id WHERE x.criado_em > now() - make_interval(days => $3)
        )`;
      const p = [id, dela, dias];
      const t = (
        await c.query<{ visitas: number; interiores: number; toursLazer: number; tempo: number | null; leads: number; missoes: Record<string, number> | null }>(
          `${base} SELECT (SELECT count(*)::int FROM ev WHERE tipo = 'abriu') AS visitas,
                          (SELECT count(*)::int FROM ev WHERE tipo = 'interior') AS interiores,
                          (SELECT count(*)::int FROM ev WHERE tipo = 'tour_lazer') AS "toursLazer",
                          (SELECT avg(duracao_s)::float8 FROM ev WHERE tipo = 'tempo') AS tempo,
                          (SELECT count(*)::int FROM ld) AS leads,
                          (SELECT jsonb_object_agg(missao, n) FROM (SELECT missao, count(DISTINCT coalesce(sessao::text, id::text))::int AS n FROM ev WHERE tipo = 'missao' GROUP BY missao) m) AS missoes`,
          p,
        )
      ).rows[0]!;
      const unidades = (
        await c.query(
          `${base} SELECT u.id, u.codigo, count(*) FILTER (WHERE ev.tipo = 'unidade')::int AS vistas, count(*) FILTER (WHERE ev.tipo = 'favorito')::int AS favoritos
                     FROM ev JOIN units u ON u.id = ev.unit_id
                    GROUP BY u.id, u.codigo
                    ORDER BY vistas DESC, favoritos DESC, u.codigo
                    LIMIT 10`,
          p,
        )
      ).rows;
      const porConsultora = (
        await c.query(
          `${base} SELECT us.id, us.nome, count(*)::int AS links,
                          (SELECT count(*)::int FROM ev JOIN lk l2 ON l2.id = ev.link_id WHERE l2.criado_por = us.id AND ev.tipo = 'abriu') AS visitas,
                          (SELECT count(*)::int FROM ld JOIN lk l2 ON l2.id = ld.link_id WHERE l2.criado_por = us.id) AS leads
                     FROM lk JOIN users us ON us.id = lk.criado_por
                    GROUP BY us.id, us.nome
                    ORDER BY leads DESC, visitas DESC, us.nome`,
          p,
        )
      ).rows;
      return {
        dias,
        visitas: t.visitas,
        interiores: t.interiores,
        toursLazer: t.toursLazer,
        // visitas (sessões) que completaram cada missão
        missoes: { lazer: 0, tipologias: 0, por_dentro: 0, por_do_sol: 0, a_pe: 0, ...(t.missoes ?? {}) },
        tempoMedioS: t.tempo === null ? null : Math.round(t.tempo),
        leads: t.leads,
        conversao: t.visitas ? t.leads / t.visitas : 0,
        unidades,
        porConsultora,
      };
    });
  });
}
