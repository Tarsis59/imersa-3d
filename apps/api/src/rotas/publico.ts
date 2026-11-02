import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { fotosNoLugar, lazerDoPredio } from './lazer';
import { transmitirSala, type CanalSala } from '../tempo-real/sala';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import { hashToken } from '../auth/hash';
import type { Armazenamento } from '../arquivos/armazenamento';
import type { criarEntorno } from './mapa';
import { transmitirPredio, type CanalUnidades } from '../tempo-real/canal';
import { giroDaVitrine } from './giros';
import { responderAssistente, type ConfigIA } from './assistente';

interface Dependencias {
  pool: pg.Pool;
  armazenamento: Armazenamento;
  entorno: ReturnType<typeof criarEntorno>;
  /** Visita em grupo: presença, posição dos bonecos e combinação da voz (Plano 11d). */
  sala?: CanalSala;
  canal: CanalUnidades;
  /** Endereço da API visto pelo navegador (status ao vivo). */
  apiPublica: string;
  ia: ConfigIA;
}

/** Link aberto pelo cliente: vale 1 h (a página pede outro se precisar). */
const DOWNLOAD_S = 60 * 60;
const TokenLink = z.object({ token: z.string().regex(/^[\w-]{43}$/) });
const TokenArquivo = TokenLink.extend({ id: z.uuid() });
const TIPOS_EVENTO = ['abriu', 'unidade', 'favorito', 'interior', 'tempo', 'tour_lazer', 'missao'] as const;
export const MISSOES = ['lazer', 'tipologias', 'por_dentro', 'por_do_sol', 'a_pe'] as const;
const Eventos = z.object({
  sessao: z.uuid(),
  eventos: z
    .array(
      z
        .object({ tipo: z.enum(TIPOS_EVENTO), unidadeId: z.uuid().optional(), duracaoS: z.number().int().min(0).max(86_400).optional(), missao: z.enum(MISSOES).optional() })
        .refine((e) => (e.tipo === 'missao') === (e.missao !== undefined), { message: 'missão só no evento de missão', path: ['missao'] }),
    )
    .min(1)
    .max(50),
});
const NomeNaSala = z.object({ nome: z.string().trim().min(1).max(40).default('Visitante') });
const SinalSala = z.object({
  de: z.uuid(),
  para: z.uuid().nullable(),
  tipo: z.enum(['posicao', 'oferta', 'resposta', 'ice']),
  dados: z.unknown(),
});
const NovoLead = z.object({
  nome: z.string().trim().min(2).max(120),
  telefone: z.string().trim().min(8).max(30).optional(),
  email: z.email().max(254).transform((e) => e.toLowerCase()).optional(),
  mensagem: z.string().trim().max(2000).optional(),
  unidadeId: z.uuid().optional(),
  consentimento: z.boolean(),
  textoConsentimento: z.string().trim().min(10).max(2000),
  /** Armadilha para robôs: campo escondido na página; gente de verdade deixa vazio. */
  site: z.string().max(500).optional(),
});
/** Limite por IP (memória da instância) + tamanho máximo do corpo. */
const limite = (max: number, janela: string, bodyLimit = 16 * 1024) => ({ bodyLimit, config: { rateLimit: { max, timeWindow: janela } } });
/** Limite por link no banco (vale para todas as instâncias da API): spam distribuído em muitos IPs num link só. */
const MAX_LEADS_POR_LINK_HORA = 20;

interface Link {
  linkId: string;
  tenantId: string;
  predioId: string;
  consultoraId: string;
}

export function rotasPublicas(app: FastifyInstance, { pool, armazenamento, entorno, canal, sala, apiPublica, ia }: Dependencias): void {
  /** Token → link válido. Desconhecido: 404; revogado ou vencido: 410 (o cliente pede um link novo à consultora). */
  async function resolver(req: FastifyRequest): Promise<Link> {
    const p = TokenLink.safeParse({ token: (req.params as { token?: string }).token });
    if (!p.success) throw new ErroHttp(404, 'nao_encontrado');
    const r = await pool.query<{ link_id: string; tenant_id: string; building_id: string; criado_por: string; valido: boolean }>('SELECT * FROM resolver_link($1)', [
      hashToken(p.data.token),
    ]);
    const l = r.rows[0];
    if (!l) throw new ErroHttp(404, 'nao_encontrado');
    if (!l.valido) throw new ErroHttp(410, 'link_indisponivel');
    return { linkId: l.link_id, tenantId: l.tenant_id, predioId: l.building_id, consultoraId: l.criado_por };
  }
  const daEmpresa = (l: Link) => ({ tenantId: l.tenantId, userId: null });
  /** Só unidades do prédio do link (um id de outro prédio vira "sem unidade", não erro). */
  async function unidadesDoPredio(c: pg.PoolClient, l: Link, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const r = await c.query<{ id: string }>('SELECT id FROM units WHERE building_id = $1 AND id = ANY($2::uuid[])', [l.predioId, ids]);
    return new Set(r.rows.map((x) => x.id));
  }

  app.get('/publico/links/:token', limite(120, '1 minute'), async (req) => {
    const l = await resolver(req);
    const dados = await withTenant(pool, daEmpresa(l), async (c) => {
      const base = (
        await c.query<{
          predio: { id: string; nome: string };
          modeloId: string | null;
          projeto: { id: string; nome: string; descricao: string | null; cidade: string | null; uf: string | null; lat: number | null; lon: number | null; rotacaoGraus: number; estiloDecorado: string };
          empresa: string;
          consultora: string;
        }>(
          `SELECT json_build_object('id', b.id, 'nome', b.nome) AS predio, b.modelo_asset_id AS "modeloId",
                  json_build_object('id', p.id, 'nome', p.nome, 'descricao', p.descricao, 'cidade', p.cidade, 'uf', p.uf,
                                    'lat', ST_Y(p.geom), 'lon', ST_X(p.geom), 'rotacaoGraus', p.rotacao_graus::float8, 'estiloDecorado', p.estilo_decorado) AS projeto,
                  t.nome AS empresa, u.nome AS consultora
             FROM buildings b JOIN projects p ON p.id = b.project_id JOIN tenants t ON t.id = b.tenant_id, users u
            WHERE b.id = $1 AND u.id = $2`,
          [l.predioId, l.consultoraId],
        )
      ).rows[0]!;
      const andares = (await c.query<{ numero: number; nome: string }>('SELECT numero, nome FROM floors WHERE building_id = $1 ORDER BY numero DESC', [l.predioId])).rows;
      const unidades = (
        await c.query(
          `SELECT u.id, u.codigo, f.numero AS andar, u.status, u.preco::float8 AS preco, u.mesh_node_id AS "meshNodeId",
                  t.nome AS tipologia, t.area_m2::float8 AS "areaM2", t.quartos
             FROM units u JOIN floors f ON f.id = u.floor_id LEFT JOIN unit_types t ON t.id = u.unit_type_id
            WHERE u.building_id = $1 ORDER BY u.codigo`,
          [l.predioId],
        )
      ).rows;
      const arquivos = (
        await c.query<{ id: string; nome: string; tipo: string; chave: string }>(
          "SELECT id, nome, tipo, chave FROM assets WHERE project_id = $1 AND status = 'pronto' AND (tipo = 'splat' OR id = $2) ORDER BY criado_em",
          [base.projeto.id, base.modeloId],
        )
      ).rows;
      return { base, andares, unidades, arquivos, giro: await giroDaVitrine(c, l.predioId), lazer: await lazerDoPredio(c, l.predioId), fotos: await fotosNoLugar(c, base.projeto.id) };
    });
    const { base, andares, unidades, arquivos, giro, lazer, fotos } = dados;
    const modelo = arquivos.find((a) => a.id === base.modeloId && a.tipo === 'modelo_3d');
    return {
      empresa: { nome: base.empresa },
      consultora: { nome: base.consultora },
      projeto: base.projeto,
      predio: base.predio,
      andares,
      unidades,
      modeloUrl: modelo
        ? await armazenamento.urlDownload({ chave: modelo.chave, assetId: modelo.id, tenantId: l.tenantId, nomeArquivo: modelo.nome, expiraS: DOWNLOAD_S })
        : null,
      interiores: arquivos.filter((a) => a.tipo === 'splat').map((a) => ({ id: a.id, nome: a.nome })),
      giro,
      lazer,
      fotos,
      // o portal chama o assistente direto na API (resposta em fluxo)
      assistenteUrl: ia.chamar ? `${apiPublica}/publico/links/${(req.params as { token: string }).token}/assistente` : null,
      aoVivoUrl: `${apiPublica}/publico/links/${(req.params as { token: string }).token}/ao-vivo`,
    };
  });

  /** Status das unidades ao vivo para o cliente (uma unidade vendida agora muda de cor na tela dele). */
  app.get('/publico/links/:token/ao-vivo', limite(30, '1 minute'), async (req, reply) => {
    const l = await resolver(req);
    await transmitirPredio(req, reply, canal, { tenantId: l.tenantId, predioId: l.predioId, linkId: l.linkId });
  });

  // visita em grupo: a sala é o link (quem tem o link da família entra junto)
  app.get('/publico/links/:token/sala', limite(30, '1 minute'), async (req, reply) => {
    if (!sala) throw new ErroHttp(503, 'sala_indisponivel');
    const l = await resolver(req);
    const { nome } = NomeNaSala.parse(req.query);
    await transmitirSala(req, reply, sala, { t: l.tenantId, l: l.linkId, nome });
  });
  app.post('/publico/links/:token/sala/sinal', limite(900, '1 minute', 16 * 1024), async (req, reply) => {
    if (!sala) throw new ErroHttp(503, 'sala_indisponivel');
    const l = await resolver(req);
    const s = SinalSala.parse(req.body);
    try {
      await sala.enviar({ t: l.tenantId, l: l.linkId, de: s.de, para: s.para, tipo: s.tipo, dados: s.dados });
    } catch {
      throw new ErroHttp(413, 'sinal_grande_demais');
    }
    return reply.status(204).send();
  });

  app.get('/publico/links/:token/entorno', limite(60, '1 minute'), async (req) => {
    const l = await resolver(req);
    const projetoId = await withTenant(pool, daEmpresa(l), async (c) => (await c.query<{ project_id: string }>('SELECT project_id FROM buildings WHERE id = $1', [l.predioId])).rows[0]!.project_id);
    return entorno.obter(daEmpresa(l), projetoId);
  });

  /** Link de um arquivo 3D do empreendimento do link (interior real, modelo do prédio ou o giro 360° do prédio). */
  app.get('/publico/links/:token/arquivos/:id', limite(60, '1 minute'), async (req) => {
    const l = await resolver(req);
    const { id } = TokenArquivo.parse(req.params);
    const a = await withTenant(pool, daEmpresa(l), async (c) =>
      (
        await c.query<{ chave: string; nome: string }>(
          `SELECT a.chave, a.nome FROM assets a JOIN buildings b ON b.project_id = a.project_id
            WHERE a.id = $1 AND b.id = $2 AND a.status = 'pronto'
              AND (a.tipo IN ('splat', 'modelo_3d') OR EXISTS (SELECT 1 FROM giros g WHERE g.zip_asset_id = a.id AND g.building_id = b.id)
                   OR (a.tipo = 'imagem' AND a.lat IS NOT NULL AND a.papel IN ('foto', 'fachada', 'render')))`,
          [id, l.predioId],
        )
      ).rows[0],
    );
    if (!a) throw new ErroHttp(404, 'nao_encontrado');
    return { nome: a.nome, url: await armazenamento.urlDownload({ chave: a.chave, assetId: id, tenantId: l.tenantId, nomeArquivo: a.nome, expiraS: DOWNLOAD_S }) };
  });

  app.post('/publico/links/:token/eventos', limite(120, '1 minute'), async (req, reply) => {
    const l = await resolver(req);
    const d = Eventos.parse(req.body);
    const navegador = req.headers['user-agent']?.slice(0, 400) ?? null;
    await withTenant(pool, daEmpresa(l), async (c) => {
      const validas = await unidadesDoPredio(c, l, d.eventos.flatMap((e) => (e.unidadeId ? [e.unidadeId] : [])));
      await c.query(
        `INSERT INTO view_events (link_id, sessao, tipo, unit_id, duracao_s, missao, ip, navegador)
         SELECT $1, $2, e.tipo, e.unidade, e.duracao, e.missao, $3, $4 FROM jsonb_to_recordset($5::jsonb) AS e(tipo text, unidade uuid, duracao integer, missao text)`,
        [
          l.linkId,
          d.sessao,
          req.ip,
          navegador,
          JSON.stringify(d.eventos.map((e) => ({ tipo: e.tipo, unidade: e.unidadeId && validas.has(e.unidadeId) ? e.unidadeId : null, duracao: e.duracaoS ?? null, missao: e.missao ?? null }))),
        ],
      );
    });
    return reply.status(204).send();
  });

  /** Assistente com IA no portal: só o prédio do link, com limite por IP (cada pergunta custa tokens). */
  app.post('/publico/links/:token/assistente', limite(20, '10 minutes', 64 * 1024), async (req, reply) => {
    const l = await resolver(req);
    const projetoId = await withTenant(pool, daEmpresa(l), async (c) => (await c.query<{ project_id: string }>('SELECT project_id FROM buildings WHERE id = $1', [l.predioId])).rows[0]!.project_id);
    await responderAssistente(req, reply, { ia, pool, tenantId: l.tenantId, contexto: { predioId: l.predioId, projetoId } });
  });

  /** Pedido de contato. LGPD: só com consentimento explícito; guarda o texto aceito, a data, o IP e o navegador como prova. */
  app.post('/publico/links/:token/leads', limite(10, '10 minutes', 8 * 1024), async (req, reply) => {
    const l = await resolver(req);
    const d = NovoLead.parse(req.body);
    if (d.consentimento !== true) throw new ErroHttp(400, 'consentimento_obrigatorio');
    if (!d.telefone && !d.email) throw new ErroHttp(400, 'contato_obrigatorio');
    // robô preencheu o campo escondido: responde como se tivesse dado certo (não ensina a contornar) e não grava
    if (d.site) return reply.status(201).send({ id: randomUUID() });
    const novo = await withTenant(pool, daEmpresa(l), async (c) => {
      const recentes = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM leads WHERE link_id = $1 AND criado_em > now() - interval '1 hour'", [l.linkId])).rows[0]!.n;
      if (recentes >= MAX_LEADS_POR_LINK_HORA) throw new ErroHttp(429, 'muitos_pedidos');
      const unidade = d.unidadeId && (await unidadesDoPredio(c, l, [d.unidadeId])).has(d.unidadeId) ? d.unidadeId : null;
      const r = await c.query<{ id: string }>(
        `INSERT INTO leads (link_id, unit_id, nome, telefone, email, mensagem, consentimento, texto_consentimento, ip, navegador)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9) RETURNING id`,
        [l.linkId, unidade, d.nome, d.telefone ?? null, d.email ?? null, d.mensagem || null, d.textoConsentimento, req.ip, req.headers['user-agent']?.slice(0, 400) ?? null],
      );
      return r.rows[0]!;
    });
    return reply.status(201).send({ id: novo.id });
  });
}
