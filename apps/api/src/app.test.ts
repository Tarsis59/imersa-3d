import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { hashSenha } from './auth/senha';
import { codigoTotp } from './auth/totp';
import type { Config } from './config';

const OWNER = process.env.TEST_API_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api';
const APP = process.env.TEST_API_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api';
const config: Config = {
  DATABASE_URL: APP,
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
  PORT: 0,
  CORS_ORIGIN: 'http://localhost:3000',
  RATE_LIMIT_AUTH: 1000,
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

describe('saúde e documentação', () => {
  it('GET /health', async () => expect((await req('GET', '/health')).status).toBe(200));
  it('GET /openapi.json descreve as rotas', async () => {
    const r = await req('GET', '/openapi.json');
    expect(r.json.openapi).toBe('3.1.0');
    expect(Object.keys(r.json.paths)).toEqual(expect.arrayContaining(['/auth/login', '/auth/registro', '/projetos']));
  });
  it('cabeçalhos de segurança (helmet)', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('fluxo multiempresa', () => {
  let tokenA = '';
  let tokenB = '';
  let refreshA = '';

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
    refreshA = ok.json.refresh;
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

  it('sem token ou com token inválido → 401', async () => {
    expect((await req('GET', '/projetos')).status).toBe(401);
    expect((await req('GET', '/projetos', undefined, 'abc.def.ghi')).status).toBe(401);
  });

  it('ISOLAMENTO: a empresa B não vê o projeto da empresa A', async () => {
    expect((await req('POST', '/projetos', { nome: 'Residencial Paulista' }, tokenA)).status).toBe(201);
    expect((await req('GET', '/projetos', undefined, tokenA)).json).toHaveLength(1);
    expect((await req('GET', '/projetos', undefined, tokenB)).json).toHaveLength(0);
  });

  it('RBAC: consultora lê projetos mas não cria', async () => {
    const t = await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'empresa-a'");
    const u = await owner.query<{ id: string }>(
      "INSERT INTO users (nome, email, senha_hash) VALUES ('Consultora', 'c@teste.com', $1) RETURNING id",
      [await hashSenha(SENHA)],
    );
    await owner.query("INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, 'consultora')", [t.rows[0]!.id, u.rows[0]!.id]);
    const c = await login('c@teste.com', 'empresa-a');
    expect(c.json.papel).toBe('consultora');
    expect((await req('POST', '/projetos', { nome: 'Proibido' }, c.json.acesso)).status).toBe(403);
    expect((await req('GET', '/projetos', undefined, c.json.acesso)).json).toHaveLength(1);
    expect((await req('GET', '/auditoria', undefined, c.json.acesso)).status).toBe(403);
  });

  it('/me lista só as empresas do usuário', async () => {
    const r = await req('GET', '/me', undefined, tokenA);
    expect(r.json.empresas.map((e: { slug: string }) => e.slug)).toEqual(['empresa-a']);
  });

  it('auditoria registra as ações e respeita a empresa', async () => {
    const a = (await req('GET', '/auditoria', undefined, tokenA)).json.map((e: { acao: string }) => e.acao);
    expect(a).toEqual(expect.arrayContaining(['empresa.registrar', 'projeto.criar']));
    const b = (await req('GET', '/auditoria', undefined, tokenB)).json.map((e: { acao: string }) => e.acao);
    expect(b).not.toContain('projeto.criar');
  });

  it('refresh rotativo: reuso revoga a família inteira', async () => {
    const r1 = await req('POST', '/auth/refresh', { refresh: refreshA });
    expect(r1.status).toBe(200);
    expect((await req('GET', '/projetos', undefined, r1.json.acesso)).status).toBe(200);
    const reuso = await req('POST', '/auth/refresh', { refresh: refreshA });
    expect(reuso.status).toBe(401);
    expect(reuso.json.erro).toBe('refresh_reutilizado');
    expect((await req('POST', '/auth/refresh', { refresh: r1.json.refresh })).status).toBe(401);
  });

  it('MFA TOTP: ativa, confirma e passa a ser exigido no login', async () => {
    const at = await req('POST', '/auth/mfa/ativar', {}, tokenB);
    expect(at.status).toBe(200);
    expect(at.json.otpauth).toMatch(/^otpauth:\/\/totp\//);
    const certo = codigoTotp(at.json.segredo);
    const errado = certo === '000000' ? '111111' : '000000';
    expect((await req('POST', '/auth/mfa/confirmar', { codigo: errado }, tokenB)).status).toBe(400);
    expect((await req('POST', '/auth/mfa/confirmar', { codigo: certo }, tokenB)).status).toBe(204);

    const sem = await login('b@teste.com', 'empresa-b');
    expect(sem.status).toBe(401);
    expect(sem.json.erro).toBe('mfa_obrigatorio');
    const com = await login('b@teste.com', 'empresa-b', { codigoMfa: codigoTotp(at.json.segredo) });
    expect(com.status).toBe(200);
  });
});
