import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { codigoTotp } from './auth/totp';
import type { Config } from './config';

const OWNER = process.env.TEST_API_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api';
const APP = process.env.TEST_API_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api';
const config: Config = {
  DATABASE_URL: APP,
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
  TOTP_KEY: randomBytes(32).toString('base64url'),
  PORT: 0,
  CORS_ORIGIN: 'http://localhost:3000',
  WEB_URL: 'http://localhost:3000',
  RATE_LIMIT_AUTH: 1000,
  RATE_LIMIT_GERAL: 300,
  TRUST_PROXY: false,
  AMBIENTE: 'teste',
  WEBHOOK_PERMITIR_LOCAL: false,
};

let app: FastifyInstance;
let pool: pg.Pool;
let owner: pg.Pool;

// Respostas JSON nos testes: `any` é intencional para ler campos sem cerimônia.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resp = { status: number; json: any };

async function req(method: 'GET' | 'POST', url: string, body?: object, token?: string): Promise<Resp> {
  const r = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : undefined };
}
const SENHA = 'senha-forte-123';
const registrar = (slug: string, email: string) =>
  req('POST', '/auth/registro', { empresa: { nome: `Empresa ${slug}`, slug }, nome: 'Admin', email, senha: SENHA });
const login = (email: string, empresa: string, extra: object = {}) => req('POST', '/auth/login', { email, senha: SENHA, empresa, ...extra });

beforeAll(async () => {
  await resetarBanco(OWNER);
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  app = await construirApp({ pool, config });
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await owner.end();
});

describe('saúde, documentação e cabeçalhos', () => {
  it('GET /health', async () => expect((await req('GET', '/health')).status).toBe(200));
  it('GET /openapi.json descreve as rotas', async () => {
    const r = await req('GET', '/openapi.json');
    expect(r.json.openapi).toBe('3.1.0');
    expect(Object.keys(r.json.paths)).toEqual(
      expect.arrayContaining(['/auth/login', '/auth/registro', '/auth/sair', '/projetos', '/membros', '/membros/convites', '/convites/aceitar']),
    );
    // API pública para CRMs: rotas, chave e o formato da assinatura dos webhooks documentados
    expect(Object.keys(r.json.paths)).toEqual(expect.arrayContaining(['/v1/leads', '/v1/unidades', '/v1/empreendimentos']));
    expect(r.json.components.securitySchemes.chaveApi).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(r.json.info.description).toContain('X-Imersa-Assinatura');
  });
  it('helmet e request-id', async () => {
    const r = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'teste-req-12345' } });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-request-id']).toBe('teste-req-12345');
    const r2 = await app.inject({ method: 'GET', url: '/health' });
    expect(r2.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('fluxo multiempresa', () => {
  let tokenA = '';
  let tokenB = '';
  let refreshA = '';
  let segredoA = '';

  it('registra duas empresas e recusa slug repetido', async () => {
    expect((await registrar('empresa-a', 'a@teste.com')).status).toBe(201);
    expect((await registrar('empresa-b', 'b@teste.com')).status).toBe(201);
    expect((await registrar('empresa-a', 'outro@teste.com')).status).toBe(409);
  });

  it('valida os dados de entrada', async () => {
    const r = await req('POST', '/auth/registro', { empresa: { nome: 'X', slug: 'A B' }, nome: 'a', email: 'nao-e-email', senha: 'curta' });
    expect(r.status).toBe(400);
    expect(r.json.erro).toBe('dados_invalidos');
  });

  it('login certo e todos os errados com a mesma resposta', async () => {
    const ok = await login('a@teste.com', 'empresa-a');
    expect(ok.status).toBe(200);
    expect(ok.json.papel).toBe('admin');
    tokenA = ok.json.acesso;
    tokenB = (await login('b@teste.com', 'empresa-b')).json.acesso;

    const errados = [
      await req('POST', '/auth/login', { email: 'a@teste.com', senha: 'errada-errada', empresa: 'empresa-a' }),
      await login('a@teste.com', 'empresa-b'),
      await login('ninguem@teste.com', 'empresa-a'),
      await login('a@teste.com', 'nao-existe'),
    ];
    for (const e of errados) {
      expect(e.status).toBe(401);
      expect(e.json.erro).toBe('credenciais_invalidas');
    }
  });

  it('admin SEM MFA lê projetos, mas não cria (403 mfa_requerido)', async () => {
    expect((await req('GET', '/projetos', undefined, tokenA)).status).toBe(200);
    const r = await req('POST', '/projetos', { nome: 'Sem MFA' }, tokenA);
    expect(r.status).toBe(403);
    expect(r.json.erro).toBe('mfa_requerido');
    expect((await req('GET', '/me', undefined, tokenA)).json).toMatchObject({ mfa: false, mfaAtivo: false });
  });

  it('MFA: código errado recusado; certo devolve tokens com mfa:true; segredo fica cifrado no banco', async () => {
    const at = await req('POST', '/auth/mfa/ativar', {}, tokenA);
    expect(at.json.otpauth).toMatch(/^otpauth:\/\/totp\//);
    const certo = codigoTotp(at.json.segredo);
    const errado = certo === '000000' ? '111111' : '000000';
    expect((await req('POST', '/auth/mfa/confirmar', { codigo: errado }, tokenA)).status).toBe(400);
    const ok = await req('POST', '/auth/mfa/confirmar', { codigo: certo }, tokenA);
    expect(ok.status).toBe(200);
    tokenA = ok.json.acesso;
    refreshA = ok.json.refresh;
    segredoA = at.json.segredo;
    const salvo = await owner.query<{ mfa_secret: string }>("SELECT mfa_secret FROM users WHERE email = 'a@teste.com'");
    expect(salvo.rows[0]!.mfa_secret.startsWith('v1.')).toBe(true);
    expect(salvo.rows[0]!.mfa_secret).not.toContain(segredoA);
    expect((await req('GET', '/me', undefined, tokenA)).json).toMatchObject({ mfa: true, mfaAtivo: true });
  });

  it('com MFA ativo o login exige o código', async () => {
    const sem = await login('a@teste.com', 'empresa-a');
    expect(sem.status).toBe(401);
    expect(sem.json.erro).toBe('mfa_obrigatorio');
    const ruim = await login('a@teste.com', 'empresa-a', { codigoMfa: codigoTotp(segredoA) === '000000' ? '111111' : '000000' });
    expect(ruim.json.erro).toBe('mfa_invalido');
    // o código usado para ativar não serve de novo: usa o da próxima janela (aceita por tolerância de relógio)
    expect((await login('a@teste.com', 'empresa-a', { codigoMfa: codigoTotp(segredoA, Date.now() + 30_000) })).status).toBe(200);
  });

  it('MFA: o mesmo código não entra duas vezes (bloqueio de reuso)', async () => {
    await owner.query("UPDATE users SET mfa_ultimo_contador = NULL WHERE email = 'a@teste.com'");
    const codigo = codigoTotp(segredoA);
    expect((await login('a@teste.com', 'empresa-a', { codigoMfa: codigo })).status).toBe(200);
    const reuso = await login('a@teste.com', 'empresa-a', { codigoMfa: codigo });
    expect(reuso.status).toBe(401);
    expect(reuso.json.erro).toBe('mfa_invalido');
    // código de uma janela anterior à já usada também é recusado
    expect((await login('a@teste.com', 'empresa-a', { codigoMfa: codigoTotp(segredoA, Date.now() - 30_000) })).status).toBe(401);
  });

  it('sem token ou com token inválido → 401', async () => {
    expect((await req('GET', '/projetos')).status).toBe(401);
    expect((await req('GET', '/projetos', undefined, 'abc.def.ghi')).status).toBe(401);
  });

  it('ISOLAMENTO: a empresa B não vê o projeto da empresa A', async () => {
    expect((await req('POST', '/projetos', { nome: 'Residencial Paulista' }, tokenA)).status).toBe(201);
    expect((await req('GET', '/projetos', undefined, tokenA)).json).toHaveLength(1);
    expect((await req('GET', '/projetos', undefined, tokenB)).json).toHaveLength(0);
  });

  it('refresh mantém o MFA; reuso revoga a família inteira', async () => {
    const r1 = await req('POST', '/auth/refresh', { refresh: refreshA });
    expect(r1.status).toBe(200);
    expect((await req('POST', '/projetos', { nome: 'Depois do refresh' }, r1.json.acesso)).status).toBe(201);
    const reuso = await req('POST', '/auth/refresh', { refresh: refreshA });
    expect(reuso.status).toBe(401);
    expect(reuso.json.erro).toBe('refresh_reutilizado');
    expect((await req('POST', '/auth/refresh', { refresh: r1.json.refresh })).status).toBe(401);
  });

  it('sair revoga o refresh', async () => {
    await owner.query("UPDATE users SET mfa_ultimo_contador = NULL WHERE email = 'a@teste.com'");
    const l = await login('a@teste.com', 'empresa-a', { codigoMfa: codigoTotp(segredoA) });
    expect((await req('POST', '/auth/sair', { refresh: l.json.refresh })).status).toBe(204);
    expect((await req('POST', '/auth/refresh', { refresh: l.json.refresh })).status).toBe(401);
  });

  it('convite: criar, consultar, aceitar com conta nova, entrar como consultora', async () => {
    const c = await req('POST', '/membros/convites', { email: 'c@teste.com', papel: 'consultora' }, tokenA);
    expect(c.status).toBe(201);
    expect(c.json.link).toBe(`http://localhost:3000/convite/${c.json.token}`);

    const info = await req('GET', `/convites/${c.json.token}`);
    expect(info.json).toEqual({ email: 'c@teste.com', papel: 'consultora', empresa: 'Empresa empresa-a', temConta: false });

    expect((await req('POST', '/convites/aceitar', { token: c.json.token, senha: SENHA })).json.erro).toBe('nome_obrigatorio');
    const ok = await req('POST', '/convites/aceitar', { token: c.json.token, senha: SENHA, nome: 'Consultora' });
    expect(ok.status).toBe(201);
    expect(ok.json.empresa).toBe('empresa-a');
    expect((await req('POST', '/convites/aceitar', { token: c.json.token, senha: SENHA, nome: 'De novo' })).status).toBe(404);

    const lc = await login('c@teste.com', 'empresa-a');
    expect(lc.json.papel).toBe('consultora');
    expect((await req('GET', '/projetos', undefined, lc.json.acesso)).json).toHaveLength(2);
    expect((await req('POST', '/projetos', { nome: 'Proibido' }, lc.json.acesso)).status).toBe(403);
    expect((await req('GET', '/membros', undefined, lc.json.acesso)).status).toBe(403);
  });

  it('convite para quem já tem conta exige a senha dessa conta', async () => {
    const c = await req('POST', '/membros/convites', { email: 'b@teste.com', papel: 'viewer' }, tokenA);
    expect((await req('GET', `/convites/${c.json.token}`)).json.temConta).toBe(true);
    expect((await req('POST', '/convites/aceitar', { token: c.json.token, senha: 'senha-errada-99' })).status).toBe(401);
    expect((await req('POST', '/convites/aceitar', { token: c.json.token, senha: SENHA })).status).toBe(201);
    const me = await req('GET', '/me', undefined, tokenB);
    expect(me.json.empresas.map((e: { slug: string }) => e.slug).sort()).toEqual(['empresa-a', 'empresa-b']);
  });

  it('convite: token inválido e papel super_admin recusados; lista de membros correta', async () => {
    expect((await req('GET', `/convites/${'x'.repeat(43)}`)).status).toBe(404);
    expect((await req('POST', '/membros/convites', { email: 'z@teste.com', papel: 'super_admin' }, tokenA)).status).toBe(400);
    const m = await req('GET', '/membros', undefined, tokenA);
    expect(m.json.membros.map((x: { email: string }) => x.email).sort()).toEqual(['a@teste.com', 'b@teste.com', 'c@teste.com']);
  });

  it('auditoria registra as ações e respeita a empresa', async () => {
    const a = (await req('GET', '/auditoria', undefined, tokenA)).json.map((e: { acao: string }) => e.acao);
    expect(a).toEqual(expect.arrayContaining(['empresa.registrar', 'mfa.ativar', 'projeto.criar', 'convite.criar', 'convite.aceitar']));
  });
});

describe('erros internos', () => {
  it('não vazam detalhes e são reportados com o request-id', async () => {
    const reportar = vi.fn();
    const quebrado = { query: async () => Promise.reject(new Error('banco caiu: senha xyz')) } as unknown as pg.Pool;
    const a = await construirApp({ pool: quebrado, config, reportarErro: reportar });
    const r = await a.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'req-com-erro-1' } });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ erro: 'erro_interno' });
    expect(reportar).toHaveBeenCalledWith(expect.any(Error), 'req-com-erro-1');
    await a.close();
  });
});
