import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { hashToken } from '../auth/hash';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import type { Armazenamento } from '../arquivos/armazenamento';
import { glbParaBlender, ModeloSemRender } from '../giros/descomprimir';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
  armazenamento: Armazenamento;
  webUrl: string;
  /** Endereço da API visto pelo PC do estande (vai no pacote do Unreal). */
  apiPublica: string;
  segredo: string;
}

/** O PC do estande fica anos no mesmo lugar: o link dele vale 10 anos (desativar é pelo painel). */
const VALIDADE_DIAS = 3650;
/** Sem sinal há mais que isso = offline (o estande manda um por minuto). */
const ONLINE_S = 180;
const NovoEstande = z.object({ nome: z.string().trim().min(1).max(80) });
const TokenEstande = z.object({ token: z.string().regex(/^[\w-]{43}$/) });
const Sinal = z.object({
  fps: z.number().int().min(0).max(1000).optional(),
  largura: z.number().int().min(0).max(20_000).optional(),
  altura: z.number().int().min(0).max(20_000).optional(),
  apresentando: z.boolean().optional(),
  versao: z.string().max(80).optional(),
});
const limite = (max: number, janela: string) => ({ bodyLimit: 4 * 1024, config: { rateLimit: { max, timeWindow: janela } } });
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

/**
 * O token do QR code sai do token do PC (HMAC com o segredo do servidor): o banco guarda só os hashes dos dois e,
 * mesmo assim, o estande consegue mostrar o QR de novo depois de reiniciar.
 */
const tokenDoQr = (segredo: string, tokenEstande: string) => createHmac('sha256', segredo).update(`qr-estande:${tokenEstande}`).digest('base64url');

export function rotasEstandes(app: FastifyInstance, { pool, exigir, armazenamento, webUrl, apiPublica, segredo }: Dependencias): void {
  // ---------------------------------------------------------------- painel (gestão)
  app.post('/predios/:id/estandes', async (req, reply) => {
    const s = await exigir(req, 'estande:gerir');
    const { id } = IdParam.parse(req.params);
    const d = NovoEstande.parse(req.body);
    const token = randomBytes(32).toString('base64url');
    const qr = tokenDoQr(segredo, token);
    const criado = await withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      const link = (hash: string, titulo: string, tipo: 'cliente' | 'estande') =>
        c
          .query<{ id: string }>(
            'INSERT INTO share_links (building_id, token_hash, titulo, criado_por, expira_em, tipo) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6) RETURNING id',
            [id, hash, titulo, s.userId, VALIDADE_DIAS, tipo],
          )
          .then((r) => r.rows[0]!.id);
      const pc = await link(hashToken(token), `Estande: ${d.nome}`.slice(0, 120), 'estande');
      const doQr = await link(hashToken(qr), `QR do estande: ${d.nome}`.slice(0, 120), 'cliente');
      const e = (await c.query<{ id: string }>('INSERT INTO estandes (building_id, nome, link_id, qr_link_id) VALUES ($1, $2, $3, $4) RETURNING id', [id, d.nome, pc, doQr])).rows[0]!;
      await registrarAuditoria(c, { userId: s.userId, acao: 'estande.criar', entidade: 'estande', entidadeId: e.id, depois: { predio: id, nome: d.nome } });
      return e;
    });
    // o endereço com o token só aparece agora (o banco guarda o hash): é o que se abre no PC do estande
    return reply.status(201).send({ id: criado.id, url: `${webUrl}/estande/${token}` });
  });

  app.get('/predios/:id/estandes', async (req) => {
    const s = await exigir(req, 'estande:gerir');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      const r = await c.query(
        `SELECT e.id, e.nome, e.criado_em AS "criadoEm", e.ultimo_sinal_em AS "ultimoSinalEm", e.info,
                CASE WHEN e.revogado_em IS NOT NULL THEN 'desativado'
                     WHEN e.ultimo_sinal_em > now() - make_interval(secs => $2) THEN 'online'
                     ELSE 'offline' END AS status,
                (e.recarregar_pedido_em IS NOT NULL AND e.recarregar_pedido_em > coalesce(e.recarregado_em, '-infinity')) AS "recarregarPendente",
                (SELECT count(*)::int FROM view_events v WHERE v.link_id = e.link_id AND v.tipo = 'abriu') AS interacoes,
                (SELECT count(*)::int FROM view_events v WHERE v.link_id = e.qr_link_id AND v.tipo = 'abriu') AS "visitasQr",
                (SELECT count(*)::int FROM leads l WHERE l.link_id IN (e.link_id, e.qr_link_id)) AS leads
           FROM estandes e
          WHERE e.building_id = $1
          ORDER BY e.revogado_em IS NOT NULL, e.criado_em DESC`,
        [id, ONLINE_S],
      );
      return r.rows;
    });
  });

  app.post('/estandes/:id/recarregar', async (req) => {
    const s = await exigir(req, 'estande:gerir');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const r = await c.query('UPDATE estandes SET recarregar_pedido_em = now() WHERE id = $1 AND revogado_em IS NULL RETURNING id', [id]);
      if (!r.rowCount) throw new ErroHttp(404, 'nao_encontrado');
      await registrarAuditoria(c, { userId: s.userId, acao: 'estande.recarregar', entidade: 'estande', entidadeId: id });
      return { status: 'pedido' };
    });
  });

  app.post('/estandes/:id/desativar', async (req) => {
    const s = await exigir(req, 'estande:gerir');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const r = await c.query<{ link_id: string; qr_link_id: string }>(
        'UPDATE estandes SET revogado_em = coalesce(revogado_em, now()) WHERE id = $1 RETURNING link_id, qr_link_id',
        [id],
      );
      const e = r.rows[0];
      if (!e) throw new ErroHttp(404, 'nao_encontrado');
      // o PC e o QR param juntos (quem já tinha o QR no celular vê "link indisponível")
      await c.query('UPDATE share_links SET revogado_em = coalesce(revogado_em, now()) WHERE id IN ($1, $2)', [e.link_id, e.qr_link_id]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'estande.desativar', entidade: 'estande', entidadeId: id });
      return { status: 'desativado' };
    });
  });

  /**
   * Pacote para o estande em Unreal Engine (Plano 09, parte com placa RTX): tudo o que o projeto do Unreal precisa
   * para montar o mesmo empreendimento e ligar as unidades às peças do modelo. Em tempo de execução, o Unreal usa o
   * token de um estande e as mesmas rotas públicas da Vitrine (dados, status ao vivo e sinal de vida).
   */
  app.get('/predios/:id/pacote-unreal', async (req) => {
    const s = await exigir(req, 'estande:gerir');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const p = (
        await c.query<{
          predio: { id: string; nome: string };
          empreendimento: { id: string; nome: string; cidade: string | null; uf: string | null; lat: number | null; lon: number | null; rotacaoGraus: number };
          modelo: { id: string; nome: string } | null;
        }>(
          `SELECT json_build_object('id', b.id, 'nome', b.nome) AS predio,
                  json_build_object('id', p.id, 'nome', p.nome, 'cidade', p.cidade, 'uf', p.uf, 'lat', ST_Y(p.geom), 'lon', ST_X(p.geom),
                                    'rotacaoGraus', p.rotacao_graus::float8) AS empreendimento,
                  (SELECT json_build_object('id', a.id, 'nome', a.nome) FROM assets a WHERE a.id = b.modelo_asset_id AND a.status = 'pronto') AS modelo
             FROM buildings b JOIN projects p ON p.id = b.project_id WHERE b.id = $1`,
          [id],
        )
      ).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      const andares = (await c.query('SELECT numero, nome FROM floors WHERE building_id = $1 ORDER BY numero', [id])).rows;
      const unidades = (
        await c.query(
          `SELECT u.id, u.codigo, f.numero AS andar, u.status, u.preco::float8 AS preco, u.mesh_node_id AS "meshNodeId",
                  t.nome AS tipologia, t.area_m2::float8 AS "areaM2", t.quartos
             FROM units u JOIN floors f ON f.id = u.floor_id LEFT JOIN unit_types t ON t.id = u.unit_type_id
            WHERE u.building_id = $1 ORDER BY f.numero, u.codigo`,
          [id],
        )
      ).rows;
      return {
        formato: 'imersa-estande/1',
        geradoEm: new Date().toISOString(),
        empreendimento: p.empreendimento,
        predio: p.predio,
        // o glTF tem Y para cima e metros; o Unreal converte sozinho (Z para cima, centímetros)
        modelo: p.modelo ? { arquivo: 'modelo.glb', compressao: 'nenhuma', unidade: 'metro', eixoCima: 'Y', nome: p.modelo.nome } : null,
        andares,
        unidades,
        coresStatus: { disponivel: '#059669', reservado: '#FBBF24', vendido: '#DC2626', bloqueado: '#64748B' },
        tempoReal: {
          descricao: 'Crie um estande no painel e use o token do endereço dele. O Unreal lê os dados, escuta o status ao vivo (SSE) e manda um sinal de vida por minuto.',
          dados: `${apiPublica}/publico/links/{token}`,
          aoVivo: `${apiPublica}/publico/links/{token}/ao-vivo`,
          sinal: `${apiPublica}/publico/estandes/{token}/sinal`,
        },
      };
    });
  });

  /** O modelo do prédio sem compressão (Meshopt): o importador glTF do Unreal não lê a geometria comprimida. */
  app.get('/predios/:id/pacote-unreal/modelo.glb', async (req, reply) => {
    const s = await exigir(req, 'estande:gerir');
    const { id } = IdParam.parse(req.params);
    const a = await withTenant(pool, ctx(s), async (c) =>
      (await c.query<{ chave: string }>("SELECT a.chave FROM buildings b JOIN assets a ON a.id = b.modelo_asset_id WHERE b.id = $1 AND a.status = 'pronto'", [id])).rows[0],
    );
    if (!a) throw new ErroHttp(404, 'sem_modelo');
    const partes: Buffer[] = [];
    for await (const p of await armazenamento.abrirLeitura(a.chave)) partes.push(p as Buffer);
    let glb: Uint8Array;
    try {
      glb = await glbParaBlender(new Uint8Array(Buffer.concat(partes)));
    } catch (e) {
      if (e instanceof ModeloSemRender) throw new ErroHttp(422, 'modelo_sem_leitor');
      throw e;
    }
    return reply.header('content-type', 'model/gltf-binary').header('content-disposition', 'attachment; filename="modelo.glb"').send(Buffer.from(glb));
  });

  // ---------------------------------------------------------------- PC do estande (token do endereço)
  async function resolver(req: FastifyRequest) {
    const p = TokenEstande.safeParse(req.params);
    if (!p.success) throw new ErroHttp(404, 'nao_encontrado');
    const r = await pool.query<{ link_id: string; tenant_id: string; valido: boolean }>('SELECT link_id, tenant_id, valido FROM resolver_link($1)', [hashToken(p.data.token)]);
    const l = r.rows[0];
    if (!l) throw new ErroHttp(404, 'nao_encontrado');
    const e = await withTenant(pool, { tenantId: l.tenant_id, userId: null }, async (c) =>
      (await c.query<{ id: string; nome: string; revogado: boolean }>('SELECT id, nome, revogado_em IS NOT NULL AS revogado FROM estandes WHERE link_id = $1', [l.link_id])).rows[0],
    );
    if (!e) throw new ErroHttp(404, 'nao_encontrado'); // link de cliente comum não é estande
    if (e.revogado || !l.valido) throw new ErroHttp(410, 'estande_desativado');
    return { ...e, tenantId: l.tenant_id, token: p.data.token };
  }

  app.get('/publico/estandes/:token', limite(60, '1 minute'), async (req) => {
    const e = await resolver(req);
    return { nome: e.nome, qrUrl: `${webUrl}/v/${tokenDoQr(segredo, e.token)}` };
  });

  /** Sinal de vida (a cada minuto): o painel mostra online/offline; a resposta diz se o painel pediu para recarregar. */
  app.post('/publico/estandes/:token/sinal', limite(12, '1 minute'), async (req) => {
    const e = await resolver(req);
    const d = Sinal.parse(req.body ?? {});
    const recarregar = await withTenant(pool, { tenantId: e.tenantId, userId: null }, async (c) => {
      const r = await c.query<{ recarregar: boolean }>(
        `UPDATE estandes x SET ultimo_sinal_em = now(), info = $2::jsonb,
                recarregado_em = CASE WHEN x.recarregar_pedido_em > coalesce(x.recarregado_em, '-infinity') THEN now() ELSE x.recarregado_em END
          FROM estandes antes
         WHERE x.id = $1 AND antes.id = x.id
         RETURNING (antes.recarregar_pedido_em IS NOT NULL AND antes.recarregar_pedido_em > coalesce(antes.recarregado_em, '-infinity')) AS recarregar`,
        [e.id, JSON.stringify(d)],
      );
      return r.rows[0]?.recarregar ?? false;
    });
    return { recarregar };
  });
}
