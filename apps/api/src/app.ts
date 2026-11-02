import { randomBytes, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { ZodError } from 'zod';
import { withTenant } from '@imersa/db';
import type { Config } from './config';
import { ErroHttp } from './erros';
import { cifrar, decifrar } from './cripto';
import { emitirAcesso, verificarAcesso, type Sessao } from './auth/tokens';
import { pode, exigeMfa, type Acao, type Papel } from './auth/rbac';
import { hashSenha, conferirSenha } from './auth/senha';
import { hashToken } from './auth/hash';
import { criarRefresh, girarRefresh, revogarFamilia } from './auth/refresh';
import { gerarSegredoTotp, contadorTotp, urlOtpauth } from './auth/totp';
import { Registro, Login, Refresh, Sair, NovoProjeto, MfaConfirmar, NovoConvite, TokenConvite, AceitarConvite } from './esquemas';
import { registrarAuditoria } from './auditoria';
import { documentoOpenApi } from './openapi';
import { rotasEmpreendimentos } from './rotas/empreendimentos';
import { rotasArquivos } from './rotas/arquivos';
import { criarEntorno, rotasMapa } from './rotas/mapa';
import { rotasTelemetria } from './rotas/telemetria';
import { rotasCapturas } from './rotas/capturas';
import { rotasVendas } from './rotas/vendas';
import { rotasPublicas } from './rotas/publico';
import { rotasAoVivo } from './rotas/ao-vivo';
import { rotasIntegracoes } from './rotas/integracoes';
import { rotasBim } from './rotas/bim';
import { rotasConfigurador } from './rotas/configurador';
import { rotasPlantas } from './rotas/plantas';
import { rotasGiros } from './rotas/giros';
import { rotasVideos } from './rotas/videos';
import { rotasEstandes } from './rotas/estandes';
import { rotasLazer } from './rotas/lazer';
import Anthropic from '@anthropic-ai/sdk';
import { rotasAssistente, type ConfigIA } from './rotas/assistente';
import { chamadaReal, type ChamarModelo } from './ia/assistente';
import { chamadaSimulada } from './ia/simulada';
import { CanalUnidades } from './tempo-real/canal';
import { ArmazenamentoLocal, ArmazenamentoS3, type Armazenamento } from './arquivos/armazenamento';
import { clamav, semAntivirus, type Antivirus } from './arquivos/antivirus';
import { comPrediosDeArquivo, servicosMapaReais, type ServicosMapa } from './mapa/osm';

export interface Deps {
  pool: pg.Pool;
  config: Config;
  logger?: boolean;
  /** Chamado em todo erro 500 (ex.: Sentry). */
  reportarErro?: (erro: unknown, requestId: string) => void;
  /** Substituíveis nos testes; por padrão vêm da configuração. */
  armazenamento?: Armazenamento;
  antivirus?: Antivirus;
  mapa?: ServicosMapa;
  /** Assistente: nos testes, um Claude de mentira; por padrão, a API do Claude se houver chave. */
  chamarIA?: ChamarModelo;
}

export function armazenamentoDaConfig(config: Config): Armazenamento {
  if (config.ARMAZENAMENTO === 's3') {
    const { S3_BUCKET, S3_REGIAO, S3_ACCESS_KEY, S3_SECRET_KEY } = config;
    if (!S3_BUCKET || !S3_REGIAO || !S3_ACCESS_KEY || !S3_SECRET_KEY) throw new Error('ARMAZENAMENTO=s3 exige S3_BUCKET, S3_REGIAO, S3_ACCESS_KEY e S3_SECRET_KEY');
    return new ArmazenamentoS3({ bucket: S3_BUCKET, regiao: S3_REGIAO, endpoint: config.S3_ENDPOINT, accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY });
  }
  return new ArmazenamentoLocal(config.ARMAZENAMENTO_PASTA ?? 'armazenamento', config.API_URL_PUBLICA ?? 'http://localhost:3333', config.JWT_SECRET);
}

// Hash real de uma senha qualquer: login de e-mail inexistente gasta o mesmo tempo (evita descobrir e-mails pelo tempo).
let hashFalso: Promise<string> | null = null;
const obterHashFalso = () => (hashFalso ??= hashSenha('senha-falsa-apenas-para-igualar-o-tempo'));

const ID_VALIDO = /^[\w-]{8,64}$/;

export async function construirApp({ pool, config, logger = false, reportarErro, armazenamento, antivirus, mapa, chamarIA }: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { level: 'info', redact: ['req.headers.authorization'] } : false,
    trustProxy: config.TRUST_PROXY,
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && ID_VALIDO.test(h) ? h : randomUUID();
    },
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  await app.register(helmet);
  // Métodos explícitos: o padrão do @fastify/cors é só GET/HEAD/POST, e o envio direto de arquivo (PUT) vem do navegador.
  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  const limiteAuth = { config: { rateLimit: { max: config.RATE_LIMIT_AUTH, timeWindow: '1 minute' } } };

  app.setErrorHandler((erro, req, reply) => {
    if (erro instanceof ZodError) {
      return reply.status(400).send({ erro: 'dados_invalidos', detalhes: erro.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })) });
    }
    if (erro instanceof ErroHttp) return reply.status(erro.status).send({ erro: erro.codigo });
    // Rede de segurança: corrida que viola uma chave única no banco vira 409, não 500.
    if ((erro as { code?: string }).code === '23505') return reply.status(409).send({ erro: 'ja_existe' });
    const status = (erro as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ erro: (erro as Error).message });
    req.log.error(erro);
    reportarErro?.(erro, req.id);
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
    if (acao && exigeMfa(sessao.papel, acao) && !sessao.mfa) throw new ErroHttp(403, 'mfa_requerido');
    return sessao;
  }
  const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

  async function papelNaEmpresa(c: pg.PoolClient, tenantId: string, userId: string): Promise<Papel | undefined> {
    const m = await c.query<{ papel: Papel }>('SELECT papel FROM memberships WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
    return m.rows[0]?.papel;
  }

  async function tokens(c: pg.PoolClient, s: Sessao) {
    return { acesso: await emitirAcesso(s, config.JWT_SECRET), refresh: await criarRefresh(c, s.userId, s.tenantId, s.mfa), papel: s.papel };
  }

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  app.get('/openapi.json', async () => documentoOpenApi());

  // ------------------------------------------------------------------ autenticação
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

  /** Cada código TOTP vale uma vez: grava a janela usada e recusa a mesma ou anteriores (atômico, sem corrida entre logins). */
  const gastarJanelaTotp = async (userId: string, janela: number) =>
    Boolean(
      (await pool.query('UPDATE users SET mfa_ultimo_contador = $1 WHERE id = $2 AND (mfa_ultimo_contador IS NULL OR mfa_ultimo_contador < $1)', [janela, userId])).rowCount,
    );

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
        const janela = contadorTotp(decifrar(user.mfa_secret, config.TOTP_KEY), d.codigoMfa);
        if (janela === null || !(await gastarJanelaTotp(user.id, janela))) throw new ErroHttp(401, 'mfa_invalido');
      }
      return tokens(c, { userId: user.id, tenantId, papel, mfa: Boolean(user.mfa_secret) });
    });
  });

  app.post('/auth/refresh', limiteAuth, async (req) => {
    const d = Refresh.parse(req.body);
    const g = await girarRefresh(pool, d.refresh);
    return withTenant(pool, { tenantId: g.tenantId, userId: g.userId }, async (c) => {
      const papel = await papelNaEmpresa(c, g.tenantId, g.userId);
      if (!papel) throw new ErroHttp(401, 'sem_acesso');
      const acesso = await emitirAcesso({ userId: g.userId, tenantId: g.tenantId, papel, mfa: g.mfa }, config.JWT_SECRET);
      return { acesso, refresh: g.novo, papel };
    });
  });

  app.post('/auth/sair', limiteAuth, async (req, reply) => {
    const d = Sair.parse(req.body);
    await revogarFamilia(pool, d.refresh);
    return reply.status(204).send();
  });

  app.post('/auth/mfa/ativar', async (req) => {
    const s = await exigir(req);
    const segredo = gerarSegredoTotp();
    const r = await pool.query<{ email: string }>('UPDATE users SET mfa_pendente = $1 WHERE id = $2 RETURNING email', [
      cifrar(segredo, config.TOTP_KEY),
      s.userId,
    ]);
    return { segredo, otpauth: urlOtpauth(segredo, r.rows[0]!.email) };
  });

  app.post('/auth/mfa/confirmar', async (req) => {
    const s = await exigir(req);
    const d = MfaConfirmar.parse(req.body);
    const r = await pool.query<{ mfa_pendente: string | null }>('SELECT mfa_pendente FROM users WHERE id = $1', [s.userId]);
    const pendente = r.rows[0]?.mfa_pendente;
    const janela = pendente ? contadorTotp(decifrar(pendente, config.TOTP_KEY), d.codigo) : null;
    if (janela === null || !(await gastarJanelaTotp(s.userId, janela))) throw new ErroHttp(400, 'codigo_invalido');
    return withTenant(pool, ctx(s), async (c) => {
      await c.query('UPDATE users SET mfa_secret = mfa_pendente, mfa_pendente = NULL WHERE id = $1', [s.userId]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'mfa.ativar', entidade: 'user', entidadeId: s.userId });
      return tokens(c, { ...s, mfa: true });
    });
  });

  app.get('/me', async (req) => {
    const s = await exigir(req);
    return withTenant(pool, { tenantId: null, userId: s.userId }, async (c) => {
      const empresas = await c.query(
        'SELECT t.id, t.nome, t.slug, m.papel FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = $1 ORDER BY t.nome',
        [s.userId],
      );
      const u = await c.query<{ nome: string; email: string; mfa_ativo: boolean }>(
        'SELECT nome, email, mfa_secret IS NOT NULL AS mfa_ativo FROM users WHERE id = $1',
        [s.userId],
      );
      const usuario = u.rows[0]!;
      return { userId: s.userId, tenantId: s.tenantId, papel: s.papel, mfa: s.mfa, mfaAtivo: usuario.mfa_ativo, nome: usuario.nome, email: usuario.email, empresas: empresas.rows };
    });
  });

  // ------------------------------------------------------------------ projetos
  app.get('/projetos', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    return withTenant(pool, ctx(s), async (c) =>
      (await c.query('SELECT id, nome, status, cidade, uf, criado_em FROM projects ORDER BY criado_em')).rows,
    );
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

  // ------------------------------------------------------------------ membros e convites
  app.get('/membros', async (req) => {
    const s = await exigir(req, 'membro:convidar');
    return withTenant(pool, ctx(s), async (c) => ({
      membros: (
        await c.query('SELECT u.id, u.nome, u.email, m.papel FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 ORDER BY u.nome', [
          s.tenantId,
        ])
      ).rows,
      convites: (
        await c.query('SELECT id, email, papel, expira_em FROM convites WHERE tenant_id = $1 AND aceito_em IS NULL AND expira_em > now() ORDER BY criado_em DESC', [
          s.tenantId,
        ])
      ).rows,
    }));
  });

  app.post('/membros/convites', async (req, reply) => {
    const s = await exigir(req, 'membro:convidar');
    const d = NovoConvite.parse(req.body);
    const token = randomBytes(32).toString('base64url');
    const criado = await withTenant(pool, ctx(s), async (c) => {
      const r = await c.query<{ id: string; expira_em: Date }>(
        "INSERT INTO convites (email, papel, token_hash, criado_por, expira_em) VALUES ($1, $2, $3, $4, now() + interval '7 days') RETURNING id, expira_em",
        [d.email, d.papel, hashToken(token), s.userId],
      );
      const cv = r.rows[0]!;
      await registrarAuditoria(c, { userId: s.userId, acao: 'convite.criar', entidade: 'convite', entidadeId: cv.id, depois: { email: d.email, papel: d.papel } });
      return cv;
    });
    return reply.status(201).send({ token, link: `${config.WEB_URL}/convite/${token}`, expiraEm: criado.expira_em });
  });

  app.get('/convites/:token', limiteAuth, async (req) => {
    const { token } = TokenConvite.parse(req.params);
    const h = hashToken(token);
    return withTenant(pool, { tenantId: null, userId: null, conviteHash: h }, async (c) => {
      const r = await c.query<{ email: string; papel: string; empresa: string; valido: boolean }>(
        'SELECT cv.email, cv.papel, t.nome AS empresa, (cv.aceito_em IS NULL AND cv.expira_em > now()) AS valido FROM convites cv JOIN tenants t ON t.id = cv.tenant_id WHERE cv.token_hash = $1',
        [h],
      );
      const cv = r.rows[0];
      if (!cv?.valido) throw new ErroHttp(404, 'convite_invalido');
      const u = await c.query('SELECT 1 FROM users WHERE email = $1', [cv.email]);
      return { email: cv.email, papel: cv.papel, empresa: cv.empresa, temConta: (u.rowCount ?? 0) > 0 };
    });
  });

  app.post('/convites/aceitar', limiteAuth, async (req, reply) => {
    const d = AceitarConvite.parse(req.body);
    const h = hashToken(d.token);
    const resultado = await withTenant(pool, { tenantId: null, userId: null, conviteHash: h }, async (c) => {
      const r = await c.query<{ id: string; tenant_id: string; email: string; papel: Papel; slug: string; valido: boolean }>(
        'SELECT cv.id, cv.tenant_id, cv.email, cv.papel, t.slug, (cv.aceito_em IS NULL AND cv.expira_em > now()) AS valido FROM convites cv JOIN tenants t ON t.id = cv.tenant_id WHERE cv.token_hash = $1 FOR UPDATE OF cv',
        [h],
      );
      const cv = r.rows[0];
      if (!cv?.valido) throw new ErroHttp(404, 'convite_invalido');

      const u = await c.query<{ id: string; senha_hash: string }>('SELECT id, senha_hash FROM users WHERE email = $1', [cv.email]);
      let userId: string;
      const existente = u.rows[0];
      if (existente) {
        if (!(await conferirSenha(existente.senha_hash, d.senha))) throw new ErroHttp(401, 'credenciais_invalidas');
        userId = existente.id;
      } else {
        if (!d.nome) throw new ErroHttp(400, 'nome_obrigatorio');
        const novo = await c.query<{ id: string }>('INSERT INTO users (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id', [
          d.nome,
          cv.email,
          await hashSenha(d.senha),
        ]);
        userId = novo.rows[0]!.id;
      }

      await c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [cv.tenant_id, userId]);
      const m = await c.query('INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [cv.tenant_id, userId, cv.papel]);
      if (m.rowCount === 0) throw new ErroHttp(409, 'ja_e_membro');
      await c.query('UPDATE convites SET aceito_em = now() WHERE id = $1', [cv.id]);
      await registrarAuditoria(c, { userId, acao: 'convite.aceitar', entidade: 'membership', entidadeId: userId, depois: { papel: cv.papel } });
      return { empresa: cv.slug };
    });
    return reply.status(201).send(resultado);
  });

  // ------------------------------------------------------------------ auditoria
  app.get('/auditoria', async (req) => {
    const s = await exigir(req, 'auditoria:ler');
    return withTenant(pool, ctx(s), async (c) =>
      (await c.query('SELECT acao, entidade, entidade_id, user_id, criado_em FROM audit_logs ORDER BY id DESC LIMIT 100')).rows,
    );
  });

  rotasEmpreendimentos(app, { pool, exigir });
  const arm = armazenamento ?? armazenamentoDaConfig(config);
  rotasArquivos(app, {
    pool,
    exigir,
    armazenamento: arm,
    antivirus: antivirus ?? (config.CLAMAV_HOST ? clamav(config.CLAMAV_HOST, config.CLAMAV_PORTA ?? 3310) : semAntivirus),
    segredo: config.JWT_SECRET,
    limiteBytes: (config.LIMITE_ARMAZENAMENTO_GB ?? 50) * 1024 ** 3,
  });
  const mapaReal = servicosMapaReais(config.OSM_USER_AGENT ?? 'Imersa3D-dev/0.1 (ambiente de desenvolvimento)');
  const servicosMapa = mapa ?? (config.MAPA_ARQUIVO_PREDIOS ? comPrediosDeArquivo(mapaReal, config.MAPA_ARQUIVO_PREDIOS) : mapaReal);
  rotasMapa(app, { pool, exigir, mapa: servicosMapa });
  rotasTelemetria(app, { pool, exigir });
  rotasCapturas(app, { pool, exigir, armazenamento: arm });
  rotasBim(app, { pool, exigir });
  rotasConfigurador(app, { pool, exigir });
  rotasPlantas(app, { pool, exigir });
  rotasGiros(app, { pool, exigir });
  rotasVideos(app, { pool, exigir });
  if (config.IA_SIMULADA === 'true' && config.AMBIENTE === 'producao') throw new Error('IA_SIMULADA não pode ser usada em produção');
  const ia: ConfigIA = {
    chamar:
      chamarIA ??
      (config.IA_SIMULADA === 'true' ? chamadaSimulada() : config.ANTHROPIC_API_KEY ? chamadaReal(new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })) : null),
    modelo: config.IA_MODELO ?? 'claude-opus-5',
    limiteTokensMes: config.IA_LIMITE_TOKENS_MES ?? 5_000_000,
  };
  rotasAssistente(app, { pool, exigir, ia });
  rotasVendas(app, { pool, exigir, webUrl: config.WEB_URL });
  // status ao vivo: uma conexão LISTEN por instância; as transmissões abertas fecham antes de a API parar
  const canal = new CanalUnidades(config.DATABASE_URL);
  app.addHook('preClose', async () => canal.fechar());
  const apiPublica = config.API_URL_PUBLICA ?? `http://localhost:${config.PORT}`;
  rotasAoVivo(app, { pool, exigir, canal, segredo: config.JWT_SECRET, apiPublica });
  rotasPublicas(app, { pool, armazenamento: arm, entorno: criarEntorno(pool, servicosMapa), canal, apiPublica, ia });
  rotasIntegracoes(app, { pool, exigir, chaveCifra: config.TOTP_KEY, permitirLocal: config.WEBHOOK_PERMITIR_LOCAL });
  rotasLazer(app, { pool, exigir });
  rotasEstandes(app, { pool, exigir, armazenamento: arm, webUrl: config.WEB_URL, apiPublica, segredo: config.JWT_SECRET });

  return app;
}
