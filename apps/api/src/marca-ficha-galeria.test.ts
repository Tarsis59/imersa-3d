import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { codigoTotp } from './auth/totp';
import type { Config } from './config';

// Banco próprio deste arquivo (os arquivos de teste rodam em paralelo).
const OWNER = process.env.TEST_API10_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_10';
const APP = process.env.TEST_API10_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_10';
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const config: Config = {
  DATABASE_URL: APP,
  JWT_SECRET: SEGREDO,
  TOTP_KEY: randomBytes(32).toString('base64url'),
  PORT: 0,
  CORS_ORIGIN: 'http://localhost:3000',
  WEB_URL: 'http://localhost:3000',
  RATE_LIMIT_AUTH: 1000,
  RATE_LIMIT_GERAL: 300,
  TRUST_PROXY: true,
  AMBIENTE: 'teste',
  WEBHOOK_PERMITIR_LOCAL: false,
};
const SENHA = 'senha-forte-123';

let app: FastifyInstance;
let pool: pg.Pool;
let owner: pg.Pool;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resp = { status: number; json: any };
async function req(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: object, token?: string): Promise<Resp> {
  const r = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : undefined };
}
async function adminComMfa(slug: string, email: string): Promise<string> {
  await req('POST', '/auth/registro', { empresa: { nome: `Empresa ${slug}`, slug }, nome: 'Admin', email, senha: SENHA });
  const l = await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug });
  const at = await req('POST', '/auth/mfa/ativar', {}, l.json.acesso);
  return (await req('POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l.json.acesso)).json.acesso;
}
/** Imagem pronta direto no banco (o antivírus e o upload já têm teste próprio em arquivos.test.ts). */
async function imagem(tenantId: string, projetoId: string, nome: string, status = 'pronto'): Promise<string> {
  return (
    await owner.query<{ id: string }>(
      "INSERT INTO assets (tenant_id, project_id, tipo, nome, chave, tamanho_declarado, status) VALUES ($1, $2, 'imagem', $3, 'x/' || gen_random_uuid(), 100, $4) RETURNING id",
      [tenantId, projetoId, nome, status],
    )
  ).rows[0]!.id;
}

let admin = '';
let outraEmpresa = '';
let tenantA = '';
let tenantB = '';
let projetoA = '';
let projetoB = '';
let predioA = '';
let fotoPronta1 = '';
let fotoPronta2 = '';
let fotoNaoPronta = '';
let fotoDeOutraEmpresa = '';

beforeAll(async () => {
  await resetarBanco(OWNER);
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  app = await construirApp({ pool, config });
  admin = await adminComMfa('torre-marca', 'admin@torremarca.com');
  outraEmpresa = await adminComMfa('concorrente-marca', 'admin@concorrentemarca.com');
  tenantA = (await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'torre-marca'")).rows[0]!.id;
  tenantB = (await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'concorrente-marca'")).rows[0]!.id;
  projetoA = (await req('POST', '/projetos', { nome: 'Residencial Marca' }, admin)).json.id;
  projetoB = (await req('POST', '/projetos', { nome: 'Residencial Concorrente' }, outraEmpresa)).json.id;
  predioA = (await req('POST', `/projetos/${projetoA}/predios`, { nome: 'Torre M', andares: 1 }, admin)).json.id;
  fotoPronta1 = await imagem(tenantA, projetoA, 'piscina.jpg');
  fotoPronta2 = await imagem(tenantA, projetoA, 'fachada.jpg');
  fotoNaoPronta = await imagem(tenantA, projetoA, 'enviando.jpg', 'aguardando_envio');
  fotoDeOutraEmpresa = await imagem(tenantB, projetoB, 'logo-concorrente.jpg');
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await owner.end();
});

describe('ficha das áreas comuns: fotos (Plano 12b, item 6)', () => {
  it('cria um ponto de lazer com fotos já prontas do projeto', async () => {
    const r = await req('POST', `/predios/${predioA}/lazer`, { categoria: 'piscina', nome: 'Piscina', x: 1, z: 1, fotos: [fotoPronta1, fotoPronta2] }, admin);
    expect(r.status).toBe(201);
    expect(r.json.fotos).toEqual([fotoPronta1, fotoPronta2]);
    const lista = (await req('GET', `/predios/${predioA}/lazer`, undefined, admin)).json;
    expect(lista.find((l: { id: string }) => l.id === r.json.id).fotos).toEqual([fotoPronta1, fotoPronta2]);
  });

  it('rejeita foto que não existe, não está pronta ou é de outra empresa', async () => {
    const semExistir = await req('POST', `/predios/${predioA}/lazer`, { categoria: 'academia', nome: 'A', x: 1, z: 1, fotos: ['00000000-0000-4000-8000-000000000000'] }, admin);
    expect(semExistir.status).toBe(400);
    const naoPronta = await req('POST', `/predios/${predioA}/lazer`, { categoria: 'academia', nome: 'A', x: 1, z: 1, fotos: [fotoNaoPronta] }, admin);
    expect(naoPronta.status).toBe(400);
    const deOutraEmpresa = await req('POST', `/predios/${predioA}/lazer`, { categoria: 'academia', nome: 'A', x: 1, z: 1, fotos: [fotoDeOutraEmpresa] }, admin);
    expect(deOutraEmpresa.status).toBe(400);
  });

  it('mais de 12 fotos é rejeitado pelo esquema', async () => {
    const r = await req('POST', `/predios/${predioA}/lazer`, { categoria: 'jardim', nome: 'Jardim', x: 1, z: 1, fotos: Array.from({ length: 13 }, () => fotoPronta1) }, admin);
    expect(r.status).toBe(400);
  });

  it('edita as fotos de um ponto já criado (PATCH)', async () => {
    const criado = await req('POST', `/predios/${predioA}/lazer`, { categoria: 'churrasqueira', nome: 'Churrasqueira', x: 1, z: 1 }, admin);
    expect(criado.json.fotos).toEqual([]);
    const editado = await req('PATCH', `/lazer/${criado.json.id}`, { fotos: [fotoPronta1] }, admin);
    expect(editado.status).toBe(200);
    expect(editado.json.fotos).toEqual([fotoPronta1]);
    const rejeitado = await req('PATCH', `/lazer/${criado.json.id}`, { fotos: [fotoDeOutraEmpresa] }, admin);
    expect(rejeitado.status).toBe(400);
  });

  it('/predios/:id/fotos-projeto lista as fotos prontas (sem a que está enviando, sem a de outra empresa)', async () => {
    const r = await req('GET', `/predios/${predioA}/fotos-projeto`, undefined, admin);
    expect(r.status).toBe(200);
    const ids = r.json.map((f: { id: string }) => f.id);
    expect(ids).toEqual(expect.arrayContaining([fotoPronta1, fotoPronta2]));
    expect(ids).not.toContain(fotoNaoPronta);
    expect(ids).not.toContain(fotoDeOutraEmpresa);
  });

  it('outra empresa não vê nem edita o lazer do prédio de A (RLS)', async () => {
    expect((await req('GET', `/predios/${predioA}/lazer`, undefined, outraEmpresa)).status).toBe(404);
    expect((await req('POST', `/predios/${predioA}/lazer`, { categoria: 'piscina', nome: 'X', x: 1, z: 1 }, outraEmpresa)).status).toBe(404);
  });
});

describe('galeria do empreendimento (Plano 12b, item 7)', () => {
  it('começa vazia', async () => {
    expect((await req('GET', `/predios/${predioA}/galeria`, undefined, admin)).json).toEqual([]);
  });

  it('PUT grava a lista na ordem enviada; GET devolve nessa ordem', async () => {
    const posta = await req('PUT', `/predios/${predioA}/galeria`, { fotos: [fotoPronta2, fotoPronta1] }, admin);
    expect(posta.status).toBe(200);
    expect(posta.json.map((f: { id: string }) => f.id)).toEqual([fotoPronta2, fotoPronta1]);
    const lida = await req('GET', `/predios/${predioA}/galeria`, undefined, admin);
    expect(lida.json.map((f: { id: string }) => f.id)).toEqual([fotoPronta2, fotoPronta1]);
  });

  it('PUT de novo substitui a lista inteira (não acumula)', async () => {
    const r = await req('PUT', `/predios/${predioA}/galeria`, { fotos: [fotoPronta1] }, admin);
    expect(r.json.map((f: { id: string }) => f.id)).toEqual([fotoPronta1]);
  });

  it('rejeita foto que não existe, não está pronta ou é de outra empresa', async () => {
    expect((await req('PUT', `/predios/${predioA}/galeria`, { fotos: [fotoNaoPronta] }, admin)).status).toBe(400);
    expect((await req('PUT', `/predios/${predioA}/galeria`, { fotos: [fotoDeOutraEmpresa] }, admin)).status).toBe(400);
  });

  it('lista vazia esvazia a galeria', async () => {
    const r = await req('PUT', `/predios/${predioA}/galeria`, { fotos: [] }, admin);
    expect(r.json).toEqual([]);
  });

  it('outra empresa não vê nem edita a galeria do prédio de A (RLS)', async () => {
    expect((await req('GET', `/predios/${predioA}/galeria`, undefined, outraEmpresa)).status).toBe(404);
    expect((await req('PUT', `/predios/${predioA}/galeria`, { fotos: [] }, outraEmpresa)).status).toBe(404);
  });
});

describe('marca da incorporadora (Plano 12b, item 11)', () => {
  it('começa sem cor, sem logo e com a fonte do sistema', async () => {
    const r = await req('GET', '/empresa/marca', undefined, admin);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ logoAssetId: null, corPrimaria: null, fonte: 'sistema' });
  });

  it('PATCH grava cor, fonte e logo (o logo precisa ser uma foto pronta da própria empresa)', async () => {
    const r = await req('PATCH', '/empresa/marca', { corPrimaria: '#0369a1', fonte: 'poppins', logoAssetId: fotoPronta1 }, admin);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ logoAssetId: fotoPronta1, corPrimaria: '#0369a1', fonte: 'poppins' });
    expect((await req('GET', '/empresa/marca', undefined, admin)).json).toEqual(r.json);
  });

  it('rejeita cor fora do formato #RRGGBB e fonte fora da lista', async () => {
    expect((await req('PATCH', '/empresa/marca', { corPrimaria: 'azul' }, admin)).status).toBe(400);
    expect((await req('PATCH', '/empresa/marca', { corPrimaria: '#fff' }, admin)).status).toBe(400);
    expect((await req('PATCH', '/empresa/marca', { fonte: 'comic-sans' }, admin)).status).toBe(400);
  });

  it('rejeita logo que não é imagem pronta ou que é de outra empresa', async () => {
    expect((await req('PATCH', '/empresa/marca', { logoAssetId: fotoNaoPronta }, admin)).status).toBe(400);
    expect((await req('PATCH', '/empresa/marca', { logoAssetId: fotoDeOutraEmpresa }, admin)).status).toBe(400);
  });

  it('null tira o logo e a cor (volta para a marca padrão do sistema)', async () => {
    const r = await req('PATCH', '/empresa/marca', { logoAssetId: null, corPrimaria: null }, admin);
    expect(r.status).toBe(200);
    expect(r.json.logoAssetId).toBeNull();
    expect(r.json.corPrimaria).toBeNull();
  });

  it('cada empresa só edita a própria marca (RLS por sessão, nunca por id de outra)', async () => {
    const antes = (await req('GET', '/empresa/marca', undefined, outraEmpresa)).json;
    expect(antes).toEqual({ logoAssetId: null, corPrimaria: null, fonte: 'sistema' });
    await req('PATCH', '/empresa/marca', { corPrimaria: '#111111' }, admin);
    expect((await req('GET', '/empresa/marca', undefined, outraEmpresa)).json.corPrimaria).toBeNull();
  });
});
