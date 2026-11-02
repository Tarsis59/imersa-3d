import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { codigoTotp } from './auth/totp';
import { hashSenha } from './auth/senha';
import type { Config } from './config';

// Banco próprio deste arquivo (os arquivos de teste rodam em paralelo).
const OWNER = process.env.TEST_API9_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_9';
const APP = process.env.TEST_API9_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_9';
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
async function req(method: 'GET' | 'POST' | 'PATCH', url: string, body?: object, token?: string): Promise<Resp> {
  const r = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : undefined };
}
async function adminComMfa(slug: string, email: string): Promise<string> {
  await req('POST', '/auth/registro', { empresa: { nome: `Loteadora ${slug}`, slug }, nome: 'Gestora', email, senha: SENHA });
  const l = await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug });
  const at = await req('POST', '/auth/mfa/ativar', {}, l.json.acesso);
  return (await req('POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l.json.acesso)).json.acesso;
}

// DXF com 2 quadras de 3 lotes de 12 × 30 m (UTM fuso 23, perto de São Paulo)
const poli = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '1', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
const texto = (camada: string, x: number, y: number, t: string) => ['0', 'TEXT', '8', camada, '10', String(x), '20', String(y), '1', t];
function dxf(): string {
  const e: string[] = [];
  for (const [q, dy] of [[1, 0], [2, 50]] as const) {
    e.push(...poli('QUADRAS', [[332_998, 7_394_000 + dy - 2], [333_038, 7_394_000 + dy - 2], [333_038, 7_394_000 + dy + 32], [332_998, 7_394_000 + dy + 32]]), ...texto('QUADRAS', 333_030, 7_394_000 + dy + 31, `Q${q}`));
    for (let l = 0; l < 3; l++) {
      const x = 333_000 + l * 12;
      e.push(...poli('LOTES', [[x, 7_394_000 + dy], [x + 12, 7_394_000 + dy], [x + 12, 7_394_000 + dy + 30], [x, 7_394_000 + dy + 30]]), ...texto('NUMEROS', x + 6, 7_394_000 + dy + 15, String(l + 1)));
    }
  }
  return ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

let gestao = '';
let consultora = '';
let concorrente = '';
let predio = '';
let projeto = '';

beforeAll(async () => {
  await resetarBanco(OWNER);
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  app = await construirApp({ pool, config });
  gestao = await adminComMfa('loteadora', 'gestora@l.com');
  concorrente = await adminComMfa('concorrente', 'gestora@x.com');
  const t = await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'loteadora'");
  const u = await owner.query<{ id: string }>('INSERT INTO users (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id', ['Ana', 'ana@l.com', await hashSenha(SENHA)]);
  await owner.query("INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, 'consultora')", [t.rows[0]!.id, u.rows[0]!.id]);
  consultora = (await req('POST', '/auth/login', { email: 'ana@l.com', senha: SENHA, empresa: 'loteadora' })).json.acesso;
  projeto = (await req('POST', '/projetos', { nome: 'Residencial dos Ipês' }, gestao)).json.id;
  predio = (await req('POST', `/projetos/${projeto}/predios`, { nome: 'Loteamento', andares: 1 }, gestao)).json.id;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await owner?.end();
});

describe('loteamento (Plano 12d)', () => {
  it('prévia não grava; aplicar grava os lotes, dá a localização ao projeto e registra na auditoria', async () => {
    const previa = await req('POST', `/predios/${predio}/lotes/importar`, { formato: 'dxf', conteudo: dxf(), fuso: 23 }, gestao);
    expect(previa.status).toBe(200);
    expect(previa.json).toMatchObject({ lotes: 6, quadras: ['01', '02'], areaTotalM2: 2160, avisos: [], aplicado: false });
    expect((await req('GET', `/predios/${predio}/lotes`, undefined, consultora)).json.lotes).toEqual([]);

    const r = await req('POST', `/predios/${predio}/lotes/importar`, { formato: 'dxf', conteudo: dxf(), fuso: 23, aplicar: true }, gestao);
    expect(r.json.aplicado).toBe(true);
    const lotes = (await req('GET', `/predios/${predio}/lotes`, undefined, consultora)).json.lotes;
    expect(lotes.map((l: { quadra: string; numero: string }) => `${l.quadra}-${l.numero}`)).toEqual(['01-01', '01-02', '01-03', '02-01', '02-02', '02-03']);
    expect(lotes[0]).toMatchObject({ areaM2: 360, frenteM: 12, fundoM: 30, preco: null, status: 'disponivel' });
    expect(lotes[0].contorno).toHaveLength(4);
    const geo = (await owner.query<{ lat: number }>('SELECT ST_Y(geom) AS lat FROM projects WHERE id = $1', [projeto])).rows[0]!;
    expect(geo.lat).toBeGreaterThan(-23.6);
    expect((await owner.query("SELECT 1 FROM audit_logs WHERE acao = 'lotes.importar'")).rowCount).toBe(1);
  });

  it('preço só a gestão; a consultora reserva; reimportar o desenho mantém preço e situação', async () => {
    const [l1] = (await req('GET', `/predios/${predio}/lotes`, undefined, gestao)).json.lotes;
    expect((await req('PATCH', `/lotes/${l1.id}`, { preco: 250000 }, consultora)).status).toBe(403);
    expect((await req('PATCH', `/lotes/${l1.id}`, { preco: 250000 }, gestao)).status).toBe(200);
    expect((await req('PATCH', `/lotes/${l1.id}`, { status: 'reservado' }, consultora)).status).toBe(200);
    expect((await req('PATCH', `/lotes/${l1.id}`, { status: 'vendido' }, consultora)).status).toBe(403);
    await req('POST', `/predios/${predio}/lotes/importar`, { formato: 'dxf', conteudo: dxf(), fuso: 23, aplicar: true }, gestao);
    const depois = (await req('GET', `/predios/${predio}/lotes`, undefined, gestao)).json.lotes[0];
    expect(depois).toMatchObject({ id: l1.id, preco: 250000, status: 'reservado' });
  });

  it('o link do cliente traz os lotes; outra empresa não vê nem mexe; arquivo quebrado = 400', async () => {
    const link = (await req('POST', `/predios/${predio}/links`, {}, consultora)).json.url as string;
    const portal = (await req('GET', `/publico/links/${link.split('/').pop()}`)).json;
    expect(portal.lotes).toHaveLength(6);
    expect(portal.lotes[0]).toMatchObject({ quadra: '01', numero: '01', status: 'reservado', preco: 250000 });
    expect((await req('GET', `/predios/${predio}/lotes`, undefined, concorrente)).status).toBe(404);
    const [l1] = (await req('GET', `/predios/${predio}/lotes`, undefined, gestao)).json.lotes;
    expect((await req('PATCH', `/lotes/${l1.id}`, { preco: 1 }, concorrente)).status).toBe(404);
    expect((await req('POST', `/predios/${predio}/lotes/importar`, { formato: 'dxf', conteudo: dxf(), fuso: 23, aplicar: true }, concorrente)).status).toBe(404);
    expect((await req('POST', `/predios/${predio}/lotes/importar`, { formato: 'geojson', conteudo: '{ isto não é json' }, gestao)).status).toBe(400);
    expect((await req('POST', `/predios/${predio}/lotes/importar`, { formato: 'dxf', conteudo: 'isto\nnão\né dxf' }, gestao)).status).toBe(400);
  });
});
