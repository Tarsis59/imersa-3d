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
import { validarPlanilha } from '../dominio/planilha';
import { executarMontagem, montagensRodando, PAPEIS } from '../criacao/montagem';
import { planoDoPredio } from '../criacao/plano';
import { CATEGORIAS_LAZER, interpretarDescricao, UFS, type Descricao } from '../criacao/texto';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
  mapa: ServicosMapa;
}

const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });
const inteiro = (max: number) => z.number().int().min(0).max(max).nullable();
const texto = (max: number) => z.string().trim().min(1).max(max).nullable();
const Lat = z.number().min(-90).max(90);
const Lon = z.number().min(-180).max(180);

/** O que a leitura entendeu, depois que a pessoa conferiu (pode ter corrigido qualquer número). */
const EsquemaDescricao = z.object({
  nome: texto(120),
  andares: z.number().int().min(1).max(120).nullable(),
  unidadesPorAndar: z.number().int().min(1).max(20).nullable(),
  totalUnidades: inteiro(5000),
  subsolos: inteiro(10),
  torres: z.number().int().min(1).max(6).nullable(),
  tipologias: z
    .array(z.object({ nome: z.string().trim().min(1).max(60), quartos: z.number().int().min(0).max(10), suites: z.number().int().min(0).max(10), areaM2: z.number().positive().max(2000).nullable() }))
    .max(8),
  vagas: inteiro(20),
  lazer: z.array(z.object({ categoria: z.enum(CATEGORIAS_LAZER), nome: z.string().trim().min(1).max(120) })).max(30),
  endereco: texto(300),
  bairro: texto(120),
  cidade: texto(120),
  uf: z.enum(UFS).nullable(),
  cep: z.string().regex(/^\d{5}-?\d{3}$/).nullable(),
  precoAPartirDe: z.number().nonnegative().nullable(),
  avisos: z.array(z.string().max(300)).max(30),
}) satisfies z.ZodType<Descricao>;

const Interpretar = z.object({ texto: z.string().max(4000) });
const NovaCriacao = z.object({
  nome: z.string().trim().min(2).max(120),
  texto: z.string().max(4000).default(''),
  descricao: EsquemaDescricao,
  planilha: z.string().max(3_000_000).nullable().default(null),
  /** Estilo do apartamento decorado (móveis, piso e paredes). */
  estilo: z.enum(['moderno', 'classico', 'jovem']).default('moderno'),
  pistas: z
    .object({
      local: z.object({ lat: Lat, lon: Lon, rotulo: z.string().trim().min(1).max(300) }).nullable().optional(),
      gps: z.array(z.object({ lat: Lat, lon: Lon })).max(500).optional(),
      cep: z.string().regex(/^\d{5}-?\d{3}$/).nullable().optional(),
    })
    .default({}),
});
const Iniciar = z.object({
  // GPS e rumo (bússola) lidos do EXIF no navegador: a foto vira quadro no 3D onde foi tirada
  arquivos: z
    .array(z.object({ id: z.uuid(), papel: z.enum(PAPEIS), lat: Lat.optional(), lon: Lon.optional(), rumo: z.number().min(0).lt(360).optional() }))
    .max(200)
    .default([]),
  // para retomar: o CEP ou o ponto que faltou
  cep: z.string().regex(/^\d{5}-?\d{3}$/).nullable().optional(),
  local: z.object({ lat: Lat, lon: Lon, rotulo: z.string().trim().min(1).max(300) }).nullable().optional(),
});

/** Montagem parada há mais que isso em "montando" é de uma instância que caiu: pode retomar. */
const PARADA_MIN = 10;

const SELECAO = `SELECT id, project_id AS "projetoId", estado, etapas, descricao, arquivos, iniciada_em AS "iniciadaEm", concluida_em AS "concluidaEm",
                        criado_em AS "criadoEm", atualizado_em AS "atualizadoEm",
                        (SELECT b.id FROM buildings b WHERE b.project_id = montagens.project_id ORDER BY b.nome LIMIT 1) AS "predioId"
                   FROM montagens`;

export function rotasCriacao(app: FastifyInstance, { pool, exigir, mapa }: Dependencias): void {
  /** Lê o texto e mostra o que vai sair, sem gravar nada (a pessoa confere antes). */
  app.post('/criacao/interpretar', { bodyLimit: 64 * 1024 }, async (req) => {
    await exigir(req, 'projeto:criar');
    const { texto } = Interpretar.parse(req.body);
    const descricao = interpretarDescricao(texto);
    return { descricao, plano: resumoDoPlano(descricao) };
  });

  /** Mesmo cálculo do plano a partir da descrição corrigida (a tela recalcula a cada mudança). */
  app.post('/criacao/plano', { bodyLimit: 64 * 1024 }, async (req) => {
    await exigir(req, 'projeto:criar');
    return { plano: resumoDoPlano(EsquemaDescricao.parse(req.body)) };
  });

  app.post('/criacao', { bodyLimit: 3_200_000 }, async (req, reply) => {
    const s = await exigir(req, 'projeto:criar');
    const n = NovaCriacao.parse(req.body);
    if (n.planilha) {
      const v = validarPlanilha(n.planilha);
      if (v.erros.length) return reply.status(400).send({ erro: 'planilha_invalida', erros: v.erros.slice(0, 20) });
    } else if (!planoDoPredio(n.descricao)) {
      return reply.status(400).send({ erro: 'sem_andares' });
    }
    const r = await withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ id: string }>('INSERT INTO projects (nome, descricao, estilo_decorado) VALUES ($1, $2, $3) RETURNING id', [n.nome, n.texto.trim() ? n.texto.trim().slice(0, 4000) : null, n.estilo])).rows[0]!;
      await registrarAuditoria(c, { userId: s.userId, acao: 'projeto.criar', entidade: 'project', entidadeId: p.id, depois: { nome: n.nome, origem: 'criacao_integrada' } });
      const m = (
        await c.query<{ id: string }>('INSERT INTO montagens (project_id, texto, descricao, pistas, planilha) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5) RETURNING id', [
          p.id,
          n.texto || null,
          JSON.stringify(n.descricao),
          JSON.stringify(n.pistas),
          n.planilha,
        ])
      ).rows[0]!;
      return { projetoId: p.id, montagemId: m.id };
    });
    return reply.status(201).send(r);
  });

  /** Começa (ou retoma) a montagem com os arquivos já enviados. Não espera: a tela acompanha pelo GET. */
  app.post('/montagens/:id/iniciar', async (req, reply) => {
    const s = await exigir(req, 'projeto:criar');
    const { id } = IdParam.parse(req.params);
    const n = Iniciar.parse(req.body ?? {});
    const ok = await withTenant(pool, ctx(s), async (c) => {
      const r = await c.query(
        `UPDATE montagens SET estado = 'montando', iniciada_em = now(), concluida_em = NULL,
                arquivos = CASE WHEN jsonb_array_length($2::jsonb) > 0 THEN $2::jsonb ELSE arquivos END,
                pistas = pistas || jsonb_strip_nulls(jsonb_build_object('cep', $3::text, 'local', $4::jsonb))
          WHERE id = $1 AND (estado <> 'montando' OR atualizado_em < now() - make_interval(mins => ${PARADA_MIN}))
          RETURNING id`,
        [id, JSON.stringify(n.arquivos), n.cep ?? null, n.local ? JSON.stringify(n.local) : null],
      );
      if (!r.rowCount) {
        if (!(await c.query('SELECT 1 FROM montagens WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
        return false;
      }
      await registrarAuditoria(c, { userId: s.userId, acao: 'montagem.iniciar', entidade: 'montagem', entidadeId: id, depois: { arquivos: n.arquivos.length } });
      return true;
    });
    if (!ok) throw new ErroHttp(409, 'montagem_em_andamento');
    const rodando = executarMontagem({ pool, mapa, avisar: (erro, etapa) => req.log.warn({ err: erro, etapa, montagem: id }, 'montagem com aviso') }, s, id)
      .catch(async (e) => {
        req.log.error(e);
        await withTenant(pool, ctx(s), (c) => c.query("UPDATE montagens SET estado = 'falhou', concluida_em = now() WHERE id = $1", [id])).catch(() => undefined);
      })
      .finally(() => montagensRodando.delete(id));
    montagensRodando.set(id, rodando);
    return reply.status(202).send({ id, estado: 'montando' });
  });

  /** Medida do fluxo (Plano 11f): quantas montagens deram certo, o tempo do envio ao 3D pronto e as falhas por etapa. */
  app.get('/montagens/resumo', async (req) => {
    const s = await exigir(req, 'projeto:criar');
    return withTenant(pool, ctx(s), async (c) => {
      const t = (
        await c.query<{ total: number; prontas: number; com_avisos: number; falhas: number; mediana_ms: number | null }>(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE estado = 'pronta')::int AS prontas,
                  count(*) FILTER (WHERE estado = 'pronta_com_avisos')::int AS com_avisos, count(*) FILTER (WHERE estado = 'falhou')::int AS falhas,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM concluida_em - iniciada_em) * 1000) AS mediana_ms
             FROM montagens WHERE iniciada_em > now() - interval '90 days'`,
        )
      ).rows[0]!;
      const etapas = (
        await c.query<{ id: string; feitas: number; avisos: number; falhas: number; media_ms: number | null }>(
          `SELECT e->>'id' AS id, count(*) FILTER (WHERE e->>'estado' = 'feita')::int AS feitas, count(*) FILTER (WHERE e->>'estado' = 'aviso')::int AS avisos,
                  count(*) FILTER (WHERE e->>'estado' = 'falhou')::int AS falhas, avg((e->>'ms')::numeric)::float8 AS media_ms
             FROM montagens m, jsonb_array_elements(m.etapas) e WHERE m.iniciada_em > now() - interval '90 days' GROUP BY 1`,
        )
      ).rows;
      return {
        total: t.total,
        prontas: t.prontas,
        comAvisos: t.com_avisos,
        falhas: t.falhas,
        medianaMs: t.mediana_ms === null ? null : Math.round(t.mediana_ms),
        etapas: Object.fromEntries(etapas.map((e) => [e.id, { feitas: e.feitas, avisos: e.avisos, falhas: e.falhas, mediaMs: e.media_ms === null ? null : Math.round(e.media_ms) }])),
      };
    });
  });

  app.get('/montagens/:id', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    const r = await withTenant(pool, ctx(s), async (c) => (await c.query(`${SELECAO} WHERE id = $1`, [id])).rows[0]);
    if (!r) throw new ErroHttp(404, 'nao_encontrado');
    return r;
  });

  app.get('/projetos/:id/montagem', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    const r = await withTenant(pool, ctx(s), async (c) => (await c.query(`${SELECAO} WHERE project_id = $1 ORDER BY criado_em DESC LIMIT 1`, [id])).rows[0]);
    if (!r) throw new ErroHttp(404, 'nao_encontrado');
    return r;
  });
}

/** O que a tela mostra antes de criar: quantas unidades, andares, tipologias e o que foi decidido sozinho. */
function resumoDoPlano(d: Descricao) {
  const p = planoDoPredio(d);
  if (!p) return null;
  return {
    unidades: p.linhas.length,
    andares: p.andares,
    porAndar: p.porAndar,
    predios: p.predios,
    tipologias: p.tipologias.map((t) => ({ ...t, unidades: p.linhas.filter((l) => l.tipologia === t.nome).length })),
    lazer: p.lazer.map((l) => ({ categoria: l.categoria, nome: l.nome, noTerraco: l.y > 0 })),
    avisos: p.avisos,
  };
}
