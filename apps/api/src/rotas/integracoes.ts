import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { hashToken } from '../auth/hash';
import { cifrar } from '../cripto';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import { destinoPermitido } from '../integracoes/assinatura';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
  chaveCifra: string;
  /** Só desenvolvimento/testes: aceita webhook na rede local (receptor de teste). */
  permitirLocal: boolean;
}

export const EVENTOS_WEBHOOK = ['lead.criado', 'unidade.status'] as const;
const NovaChave = z.object({ nome: z.string().trim().min(1).max(80) });
const NovoWebhook = z.object({ url: z.string().trim().min(10).max(2000), eventos: z.array(z.enum(EVENTOS_WEBHOOK)).min(1).max(EVENTOS_WEBHOOK.length) });
const Desde = z.object({ desde: z.iso.datetime({ offset: true }).optional(), limite: z.coerce.number().int().min(1).max(500).default(100) });
const PorPredio = z.object({ predioId: z.uuid().optional() });
const STATUS = ['disponivel', 'reservado', 'vendido', 'bloqueado'] as const;
/**
 * CRM → plataforma: situação (e preço) das unidades, em lote. A unidade vem pelo nosso id ou pelo código dela no CRM
 * (`crmId`); mandar os dois grava o vínculo. Idempotente: repetir o mesmo envio não muda nada.
 */
const AtualizacaoCrm = z.object({
  unidades: z
    .array(
      z
        .object({
          id: z.uuid().optional(),
          crmId: z.string().trim().min(1).max(200).optional(),
          status: z.enum(STATUS),
          preco: z.number().min(0).max(1e11).nullable().optional(),
          motivo: z.string().trim().max(300).optional(),
        })
        .refine((u) => u.id || u.crmId, { message: 'informe id ou crmId' }),
    )
    .min(1)
    .max(500),
});
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

/** `imk_` + 32 bytes: o prefixo aparece na tela para reconhecer a chave; o resto só na criação. */
const novaChaveApi = () => `imk_${randomBytes(32).toString('base64url')}`;

export function rotasIntegracoes(app: FastifyInstance, { pool, exigir, chaveCifra, permitirLocal }: Dependencias): void {
  // ------------------------------------------------------------------ gestão (painel, com MFA)
  app.get('/integracoes', async (req) => {
    const s = await exigir(req, 'integracao:gerir');
    return withTenant(pool, ctx(s), async (c) => ({
      chaves: (
        await c.query(
          `SELECT id, nome, prefixo, criado_em AS "criadoEm", ultimo_uso AS "ultimoUso", revogada_em AS "revogadaEm"
             FROM chaves_api ORDER BY criado_em DESC`,
        )
      ).rows,
      webhooks: (
        await c.query(
          `SELECT w.id, w.url, w.eventos, w.ativo, w.criado_em AS "criadoEm",
                  count(e.id) FILTER (WHERE e.status = 'entregue')::int AS entregues,
                  count(e.id) FILTER (WHERE e.status = 'pendente')::int AS pendentes,
                  count(e.id) FILTER (WHERE e.status = 'falhou')::int AS falhas
             FROM webhooks w LEFT JOIN webhook_entregas e ON e.webhook_id = w.id
            GROUP BY w.id ORDER BY w.criado_em DESC`,
        )
      ).rows,
    }));
  });

  app.post('/integracoes/chaves', async (req, reply) => {
    const s = await exigir(req, 'integracao:gerir');
    const d = NovaChave.parse(req.body);
    const chave = novaChaveApi();
    const r = await withTenant(pool, ctx(s), async (c) => {
      const nova = (
        await c.query<{ id: string }>('INSERT INTO chaves_api (nome, prefixo, hash, criado_por) VALUES ($1, $2, $3, $4) RETURNING id', [d.nome, chave.slice(0, 12), hashToken(chave), s.userId])
      ).rows[0]!;
      await registrarAuditoria(c, { userId: s.userId, acao: 'chave_api.criar', entidade: 'chave_api', entidadeId: nova.id, depois: { nome: d.nome } });
      return nova;
    });
    return reply.status(201).send({ id: r.id, chave });
  });

  app.post('/integracoes/chaves/:id/revogar', async (req) => {
    const s = await exigir(req, 'integracao:gerir');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const r = await c.query('UPDATE chaves_api SET revogada_em = coalesce(revogada_em, now()) WHERE id = $1 RETURNING id', [id]);
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await registrarAuditoria(c, { userId: s.userId, acao: 'chave_api.revogar', entidade: 'chave_api', entidadeId: id });
      return { status: 'revogada' };
    });
  });

  app.post('/integracoes/webhooks', async (req, reply) => {
    const s = await exigir(req, 'integracao:gerir');
    const d = NovoWebhook.parse(req.body);
    if (!(await destinoPermitido(d.url, { permitirLocal }))) throw new ErroHttp(400, 'destino_invalido');
    const segredo = `whsec_${randomBytes(24).toString('base64url')}`;
    const r = await withTenant(pool, ctx(s), async (c) => {
      const novo = (
        await c.query<{ id: string }>('INSERT INTO webhooks (url, segredo_cifrado, eventos, criado_por) VALUES ($1, $2, $3, $4) RETURNING id', [
          d.url,
          cifrar(segredo, chaveCifra),
          [...new Set(d.eventos)],
          s.userId,
        ])
      ).rows[0]!;
      await registrarAuditoria(c, { userId: s.userId, acao: 'webhook.criar', entidade: 'webhook', entidadeId: novo.id, depois: { url: d.url, eventos: d.eventos } });
      return novo;
    });
    // o segredo só aparece aqui: o CRM guarda para conferir a assinatura
    return reply.status(201).send({ id: r.id, segredo });
  });

  app.delete('/integracoes/webhooks/:id', async (req, reply) => {
    const s = await exigir(req, 'integracao:gerir');
    const { id } = IdParam.parse(req.params);
    await withTenant(pool, ctx(s), async (c) => {
      const r = await c.query('DELETE FROM webhooks WHERE id = $1 RETURNING url', [id]);
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await registrarAuditoria(c, { userId: s.userId, acao: 'webhook.apagar', entidade: 'webhook', entidadeId: id, antes: { url: r.rows[0].url } });
    });
    return reply.status(204).send();
  });

  app.post('/integracoes/webhooks/:id/testar', async (req, reply) => {
    const s = await exigir(req, 'integracao:gerir');
    const { id } = IdParam.parse(req.params);
    await withTenant(pool, ctx(s), async (c) => {
      const r = await c.query("INSERT INTO webhook_entregas (webhook_id, evento, payload) SELECT id, 'teste', $2 FROM webhooks WHERE id = $1 RETURNING id", [
        id,
        JSON.stringify({ mensagem: 'Teste do Imersa 3D: se chegou, a integração funciona.' }),
      ]);
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
    });
    return reply.status(202).send({ status: 'na_fila' });
  });

  app.get('/integracoes/webhooks/:id/entregas', async (req) => {
    const s = await exigir(req, 'integracao:gerir');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM webhooks WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return (
        await c.query(
          `SELECT id, evento, status, tentativas, ultimo_status AS "ultimoStatus", ultimo_erro AS "ultimoErro",
                  criado_em AS "criadoEm", entregue_em AS "entregueEm", proxima_em AS "proximaEm"
             FROM webhook_entregas WHERE webhook_id = $1 ORDER BY criado_em DESC LIMIT 50`,
          [id],
        )
      ).rows;
    });
  });

  // ------------------------------------------------------------------ API pública para CRMs (chave da empresa)
  async function empresaDaChave(req: FastifyRequest): Promise<string> {
    const cab = req.headers.authorization;
    if (!cab?.startsWith('Bearer imk_')) throw new ErroHttp(401, 'chave_invalida');
    const r = await pool.query<{ t: string | null }>('SELECT resolver_chave_api($1) AS t', [hashToken(cab.slice(7))]);
    if (!r.rows[0]?.t) throw new ErroHttp(401, 'chave_invalida');
    return r.rows[0].t;
  }
  // limite por chave (o CRM costuma vir de um IP só, mas cada empresa tem o seu)
  const porChave = { config: { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => hashToken(req.headers.authorization ?? req.ip) } } };
  const daEmpresa = (tenantId: string) => ({ tenantId, userId: null });

  /**
   * Leads em ordem de chegada; o CRM guarda o `criadoEm` do último e pede `?desde=` na próxima vez.
   * O JSON leva a hora em milissegundos (o banco guarda microssegundos): a comparação é na mesma precisão, senão o último voltaria.
   */
  app.get('/v1/leads', porChave, async (req) => {
    const t = await empresaDaChave(req);
    const q = Desde.parse(req.query);
    return withTenant(pool, daEmpresa(t), async (c) =>
      (
        await c.query(
          `SELECT x.id, x.nome, x.telefone, x.email, x.mensagem, x.status, x.criado_em AS "criadoEm",
                  un.codigo AS unidade, b.nome AS predio, p.id AS "empreendimentoId", p.nome AS empreendimento, u.nome AS consultora
             FROM leads x JOIN share_links l ON l.id = x.link_id JOIN users u ON u.id = l.criado_por
             JOIN buildings b ON b.id = l.building_id JOIN projects p ON p.id = b.project_id LEFT JOIN units un ON un.id = x.unit_id
            WHERE ($1::timestamptz IS NULL OR date_trunc('milliseconds', x.criado_em) > $1)
            ORDER BY x.criado_em, x.id
            LIMIT $2`,
          [q.desde ?? null, q.limite],
        )
      ).rows,
    );
  });

  app.get('/v1/empreendimentos', porChave, async (req) => {
    const t = await empresaDaChave(req);
    return withTenant(pool, daEmpresa(t), async (c) =>
      (
        await c.query(
          `SELECT p.id, p.nome, p.cidade, p.uf, p.status,
                  coalesce(json_agg(json_build_object('id', b.id, 'nome', b.nome) ORDER BY b.nome) FILTER (WHERE b.id IS NOT NULL), '[]') AS predios
             FROM projects p LEFT JOIN buildings b ON b.project_id = p.id
            GROUP BY p.id ORDER BY p.nome`,
        )
      ).rows,
    );
  });

  /** Situação vinda do CRM: chega ao 3D na hora (o gatilho do banco avisa a transmissão ao vivo das Vitrines). */
  app.post('/v1/unidades/status', { ...porChave, bodyLimit: 512 * 1024 }, async (req) => {
    const t = await empresaDaChave(req);
    const d = AtualizacaoCrm.parse(req.body);
    return withTenant(pool, daEmpresa(t), async (c) => {
      const resultados: Array<{ id: string | null; crmId: string | null; resultado: 'atualizada' | 'sem_mudanca' | 'nao_encontrada' }> = [];
      for (const u of d.unidades) {
        const atual = (
          await c.query<{ id: string; status: string; preco: number | null; crm_external_id: string | null }>(
            `SELECT id, status, preco::float8 AS preco, crm_external_id FROM units WHERE ${u.id ? 'id = $1' : 'crm_external_id = $1'} FOR UPDATE`,
            [u.id ?? u.crmId],
          )
        ).rows;
        // crmId repetido em duas unidades: ambíguo, não mexe em nenhuma
        if (atual.length !== 1) {
          resultados.push({ id: u.id ?? null, crmId: u.crmId ?? null, resultado: 'nao_encontrada' });
          continue;
        }
        const x = atual[0]!;
        const novoPreco = u.preco === undefined ? x.preco : u.preco;
        const novoCrm = u.id && u.crmId ? u.crmId : x.crm_external_id;
        if (x.status === u.status && x.preco === novoPreco && x.crm_external_id === novoCrm) {
          resultados.push({ id: x.id, crmId: novoCrm, resultado: 'sem_mudanca' });
          continue;
        }
        await c.query('UPDATE units SET status = $2, preco = $3, crm_external_id = $4 WHERE id = $1', [x.id, u.status, novoPreco, novoCrm]);
        if (x.status !== u.status) {
          await c.query('INSERT INTO unit_status_history (unit_id, de, para, user_id, motivo) VALUES ($1, $2, $3, NULL, $4)', [x.id, x.status, u.status, `CRM${u.motivo ? `: ${u.motivo}` : ''}`.slice(0, 500)]);
        }
        await registrarAuditoria(c, { userId: null, acao: 'unidade.crm', entidade: 'unit', entidadeId: x.id, antes: { status: x.status, preco: x.preco }, depois: { status: u.status, preco: novoPreco } });
        resultados.push({ id: x.id, crmId: novoCrm, resultado: 'atualizada' });
      }
      const conta = (r: string) => resultados.filter((x) => x.resultado === r).length;
      return { atualizadas: conta('atualizada'), semMudanca: conta('sem_mudanca'), naoEncontradas: conta('nao_encontrada'), resultados };
    });
  });

  app.get('/v1/unidades', porChave, async (req) => {
    const t = await empresaDaChave(req);
    const { predioId } = PorPredio.parse(req.query);
    return withTenant(pool, daEmpresa(t), async (c) =>
      (
        await c.query(
          `SELECT u.id, u.crm_external_id AS "crmId", u.codigo, u.status, u.preco::float8 AS preco, f.numero AS andar, ty.nome AS tipologia, ty.area_m2::float8 AS "areaM2", ty.quartos,
                  b.id AS "predioId", b.nome AS predio, p.nome AS empreendimento
             FROM units u JOIN floors f ON f.id = u.floor_id JOIN buildings b ON b.id = u.building_id JOIN projects p ON p.id = b.project_id
             LEFT JOIN unit_types ty ON ty.id = u.unit_type_id
            WHERE ($1::uuid IS NULL OR u.building_id = $1)
            ORDER BY p.nome, b.nome, u.codigo`,
          [predioId ?? null],
        )
      ).rows,
    );
  });
}
