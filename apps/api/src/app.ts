import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { ZodError } from 'zod';
import { withTenant } from '@imersa/db';
import type { Config } from './config';
import { ErroHttp } from './erros';
import { emitirAcesso, verificarAcesso, type Sessao } from './auth/tokens';
import { pode, type Acao, type Papel } from './auth/rbac';
import { hashSenha, conferirSenha } from './auth/senha';
import { criarRefresh, girarRefresh } from './auth/refresh';
import { gerarSegredoTotp, conferirTotp, urlOtpauth } from './auth/totp';
import { Registro, Login, Refresh, NovoProjeto, MfaConfirmar } from './esquemas';
import { registrarAuditoria } from './auditoria';
import { documentoOpenApi } from './openapi';

export interface Deps {
  pool: pg.Pool;
  config: Config;
  logger?: boolean;
}

// Hash real de uma senha qualquer: login de e-mail inexistente gasta o mesmo tempo (evita descobrir e-mails pelo tempo).
let hashFalso: Promise<string> | null = null;
const obterHashFalso = () => (hashFalso ??= hashSenha('senha-falsa-apenas-para-igualar-o-tempo'));

export async function construirApp({ pool, config, logger = false }: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger ? { level: 'info', redact: ['req.headers.authorization'] } : false });
  await app.register(helmet);
  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  const limiteAuth = { config: { rateLimit: { max: config.RATE_LIMIT_AUTH, timeWindow: '1 minute' } } };

  app.setErrorHandler((erro, req, reply) => {
    if (erro instanceof ZodError) {
      return reply.status(400).send({ erro: 'dados_invalidos', detalhes: erro.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })) });
    }
    if (erro instanceof ErroHttp) return reply.status(erro.status).send({ erro: erro.codigo });
    const status = (erro as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ erro: (erro as Error).message });
    req.log.error(erro);
    return reply.status(500).send({ erro: 'erro_interno' });
  });

  async function exigir(req: FastifyRequest, acao?: Acao): Promise<Sessao> {
    const cabecalho = req.headers.authorization;
    if (!cabecalho?.startsWith('Bearer ')) throw new ErroHttp(401, 'nao_autenticado');
    let sessao: Sessao;
    try {
      sessao = await verificarAcesso(cabecalho.slice(7), config.JWT_SECRET);
    } catch {
      throw new ErroHttp(401, 'token_invalido');
    }
    if (acao && !pode(sessao.papel, acao)) throw new ErroHttp(403, 'sem_permissao');
    return sessao;
  }
  const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

  async function papelNaEmpresa(c: pg.PoolClient, tenantId: string, userId: string): Promise<Papel | undefined> {
    const m = await c.query<{ papel: Papel }>('SELECT papel FROM memberships WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
    return m.rows[0]?.papel;
  }

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  app.get('/openapi.json', async () => documentoOpenApi());

  app.post('/auth/registro', limiteAuth, async (req, reply) => {
    const d = Registro.parse(req.body);
    const senhaHash = await hashSenha(d.senha);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const t = await c.query<{ id: string }>('INSERT INTO tenants (nome, slug) VALUES ($1, $2) RETURNING id', [d.empresa.nome, d.empresa.slug]);
      const u = await c.query<{ id: string }>('INSERT INTO users (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id', [d.nome, d.email, senhaHash]);
      const tenantId = t.rows[0]!.id;
      const userId = u.rows[0]!.id;
      await c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [tenantId, userId]);
      await c.query("INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, 'admin')", [tenantId, userId]);
      await registrarAuditoria(c, { userId, acao: 'empresa.registrar', entidade: 'tenant', entidadeId: tenantId, depois: d.empresa });
      await c.query('COMMIT');
      return reply.status(201).send({ tenantId, userId });
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      if ((e as { code?: string }).code === '23505') throw new ErroHttp(409, 'ja_existe');
      throw e;
    } finally {
      c.release();
    }
  });

  app.post('/auth/login', limiteAuth, async (req) => {
    const d = Login.parse(req.body);
    const r = await pool.query<{ id: string; senha_hash: string; mfa_secret: string | null }>(
      'SELECT id, senha_hash, mfa_secret FROM users WHERE email = $1',
      [d.email],
    );
    const user = r.rows[0];
    const senhaOk = await conferirSenha(user?.senha_hash ?? (await obterHashFalso()), d.senha);
    if (!user || !senhaOk) throw new ErroHttp(401, 'credenciais_invalidas');
    const t = await pool.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [d.empresa]);
    const tenantId = t.rows[0]?.id;
    if (!tenantId) throw new ErroHttp(401, 'credenciais_invalidas');

    return withTenant(pool, { tenantId, userId: user.id }, async (c) => {
      const papel = await papelNaEmpresa(c, tenantId, user.id);
      if (!papel) throw new ErroHttp(401, 'credenciais_invalidas');
      if (user.mfa_secret) {
        if (!d.codigoMfa) throw new ErroHttp(401, 'mfa_obrigatorio');
        if (!conferirTotp(user.mfa_secret, d.codigoMfa)) throw new ErroHttp(401, 'mfa_invalido');
      }
      const sessao: Sessao = { userId: user.id, tenantId, papel };
      return { acesso: await emitirAcesso(sessao, config.JWT_SECRET), refresh: await criarRefresh(c, user.id, tenantId), papel };
    });
  });

  app.post('/auth/refresh', limiteAuth, async (req) => {
    const d = Refresh.parse(req.body);
    const g = await girarRefresh(pool, d.refresh);
    return withTenant(pool, { tenantId: g.tenantId, userId: g.userId }, async (c) => {
      const papel = await papelNaEmpresa(c, g.tenantId, g.userId);
      if (!papel) throw new ErroHttp(401, 'sem_acesso');
      return { acesso: await emitirAcesso({ userId: g.userId, tenantId: g.tenantId, papel }, config.JWT_SECRET), refresh: g.novo, papel };
    });
  });

  app.post('/auth/mfa/ativar', async (req) => {
    const s = await exigir(req);
    const segredo = gerarSegredoTotp();
    const r = await pool.query<{ email: string }>('UPDATE users SET mfa_pendente = $1 WHERE id = $2 RETURNING email', [segredo, s.userId]);
    return { segredo, otpauth: urlOtpauth(segredo, r.rows[0]!.email) };
  });

  app.post('/auth/mfa/confirmar', async (req, reply) => {
    const s = await exigir(req);
    const d = MfaConfirmar.parse(req.body);
    const r = await pool.query<{ mfa_pendente: string | null }>('SELECT mfa_pendente FROM users WHERE id = $1', [s.userId]);
    const pendente = r.rows[0]?.mfa_pendente;
    if (!pendente || !conferirTotp(pendente, d.codigo)) throw new ErroHttp(400, 'codigo_invalido');
    await withTenant(pool, ctx(s), async (c) => {
      await c.query('UPDATE users SET mfa_secret = mfa_pendente, mfa_pendente = NULL WHERE id = $1', [s.userId]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'mfa.ativar', entidade: 'user', entidadeId: s.userId });
    });
    return reply.status(204).send();
  });

  app.get('/me', async (req) => {
    const s = await exigir(req);
    return withTenant(pool, { tenantId: null, userId: s.userId }, async (c) => {
      const r = await c.query(
        'SELECT t.id, t.nome, t.slug, m.papel FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = $1 ORDER BY t.nome',
        [s.userId],
      );
      return { userId: s.userId, tenantId: s.tenantId, papel: s.papel, empresas: r.rows };
    });
  });

  app.get('/projetos', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    return withTenant(pool, ctx(s), async (c) => (await c.query('SELECT id, nome, criado_em FROM projects ORDER BY criado_em')).rows);
  });

  app.post('/projetos', async (req, reply) => {
    const s = await exigir(req, 'projeto:criar');
    const d = NovoProjeto.parse(req.body);
    const novo = await withTenant(pool, ctx(s), async (c) => {
      const r = await c.query<{ id: string; nome: string; criado_em: Date }>('INSERT INTO projects (nome) VALUES ($1) RETURNING id, nome, criado_em', [d.nome]);
      const p = r.rows[0]!;
      await registrarAuditoria(c, { userId: s.userId, acao: 'projeto.criar', entidade: 'project', entidadeId: p.id, depois: { nome: p.nome } });
      return p;
    });
    return reply.status(201).send(novo);
  });

  app.get('/auditoria', async (req) => {
    const s = await exigir(req, 'auditoria:ler');
    return withTenant(pool, ctx(s), async (c) =>
      (await c.query('SELECT acao, entidade, entidade_id, user_id, criado_em FROM audit_logs ORDER BY id DESC LIMIT 100')).rows,
    );
  });

  return app;
}
