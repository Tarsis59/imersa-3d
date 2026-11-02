import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { codigoTotp } from './auth/totp';
import type { Config } from './config';

// Banco próprio deste arquivo (os arquivos de teste rodam em paralelo); 2ª rodada do Plano 12d (itens 6 a 11).
const OWNER = process.env.TEST_API11_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_11';
const APP = process.env.TEST_API11_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_11';
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

// DXF com 1 quadra de 2 lotes de 12 × 30 m (UTM fuso 23, perto de São Paulo) — igual ao de loteamento.test.ts
const poli = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '1', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
const linha = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '0', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
const texto = (camada: string, x: number, y: number, t: string) => ['0', 'TEXT', '8', camada, '10', String(x), '20', String(y), '1', t];
function dxf(comTerreno = false): string {
  const e: string[] = [];
  e.push(...poli('QUADRAS', [[332_998, 7_394_000 - 2], [333_038, 7_394_000 - 2], [333_038, 7_394_000 + 32], [332_998, 7_394_000 + 32]]), ...texto('QUADRAS', 333_030, 7_394_000 + 31, 'Q1'));
  for (let l = 0; l < 2; l++) {
    const x = 333_000 + l * 12;
    e.push(...poli('LOTES', [[x, 7_394_000], [x + 12, 7_394_000], [x + 12, 7_394_000 + 30], [x, 7_394_000 + 30]]), ...texto('NUMEROS', x + 6, 7_394_000 + 15, String(l + 1)));
  }
  if (comTerreno) {
    // terreno e infraestrutura (item 8): rua, calçada e meio-fio em frente à quadra
    e.push(...linha('RUAS', [[332_990, 7_394_000 - 6], [333_046, 7_394_000 - 6]]));
    e.push(...linha('CALCADAS', [[332_990, 7_394_000 - 3], [333_046, 7_394_000 - 3]]));
    e.push(...linha('MEIO_FIO', [[332_990, 7_394_000 - 4], [333_046, 7_394_000 - 4]]));
  }
  return ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

let gestao = '';

/** Projeto + prédio + loteamento importado do zero (cada teste com o seu, para o lazer não se misturar). */
async function novoLoteamento(nome: string, comTerreno = false): Promise<string> {
  const projeto = (await req('POST', '/projetos', { nome }, gestao)).json.id;
  const predio = (await req('POST', `/projetos/${projeto}/predios`, { nome: 'Loteamento', andares: 1 }, gestao)).json.id;
  await req('POST', `/predios/${predio}/lotes/importar`, { formato: 'dxf', conteudo: dxf(comTerreno), fuso: 23, aplicar: true }, gestao);
  return predio;
}

beforeAll(async () => {
  await resetarBanco(OWNER);
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  app = await construirApp({ pool, config });
  gestao = await adminComMfa('loteadora12d', 'gestora@l12d.com');
}, 60_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await owner?.end();
});

describe('orientação e distância ao clube (Plano 12d, item 6)', () => {
  it('sem lazer marcado: orientação vem preenchida (do próprio desenho) e o clube fica null', async () => {
    const predio = await novoLoteamento('Residencial sem lazer');
    const lotes = (await req('GET', `/predios/${predio}/lotes`, undefined, gestao)).json.lotes;
    expect(lotes).toHaveLength(2);
    for (const l of lotes) {
      expect(l.orientacao).toMatchObject({ rotulo: expect.any(String), anguloGraus: expect.any(Number), dica: expect.any(String) });
      expect(l.clube).toBeNull();
    }
  });

  it('com um "Clube" marcado no lazer: a distância aparece, aproximada (sem ruas em volta cadastradas)', async () => {
    const predio = await novoLoteamento('Residencial com clube');
    await req('POST', `/predios/${predio}/lazer`, { categoria: 'salao_festas', nome: 'Clube social', x: 20, y: 0, z: -30 }, gestao);
    const lotes = (await req('GET', `/predios/${predio}/lotes`, undefined, gestao)).json.lotes;
    for (const l of lotes) {
      expect(l.clube).toMatchObject({ aproximado: true });
      expect(l.clube.metros).toBeGreaterThan(0);
    }
  });

  it('sem "Clube" pelo nome: usa o primeiro ponto de lazer da ordem do tour', async () => {
    const predio = await novoLoteamento('Residencial sem clube nomeado');
    await req('POST', `/predios/${predio}/lazer`, { categoria: 'piscina', nome: 'Piscina', x: 5, y: 0, z: 5, ordem: 0 }, gestao);
    await req('POST', `/predios/${predio}/lazer`, { categoria: 'academia', nome: 'Academia', x: -5, y: 0, z: -5, ordem: 1 }, gestao);
    const lotes = (await req('GET', `/predios/${predio}/lotes`, undefined, gestao)).json.lotes;
    expect(lotes[0].clube).not.toBeNull();
    expect(lotes[0].clube.aproximado).toBe(true);
  });
});

describe('áreas de convívio por categoria (Plano 12d, item 7)', () => {
  it('cada tipo entra num grupo padrão (Lazer, Sociais, Gastronomia, Beach Sports, Pet) quando não escolhido', async () => {
    const predio = await novoLoteamento('Residencial com categorias');
    const piscina = await req('POST', `/predios/${predio}/lazer`, { categoria: 'piscina', nome: 'Piscina', x: 1, z: 1 }, gestao);
    expect(piscina.json.grupo).toBe('lazer');
    const churrasco = await req('POST', `/predios/${predio}/lazer`, { categoria: 'churrasqueira', nome: 'Churrasqueira', x: 1, z: 1 }, gestao);
    expect(churrasco.json.grupo).toBe('gastronomia');
    const quadra = await req('POST', `/predios/${predio}/lazer`, { categoria: 'quadra', nome: 'Quadra de beach tennis', x: 1, z: 1 }, gestao);
    expect(quadra.json.grupo).toBe('beach_sports');
    const pet = await req('POST', `/predios/${predio}/lazer`, { categoria: 'pet', nome: 'Espaço pet', x: 1, z: 1 }, gestao);
    expect(pet.json.grupo).toBe('pet');
    const salao = await req('POST', `/predios/${predio}/lazer`, { categoria: 'salao_festas', nome: 'Salão', x: 1, z: 1 }, gestao);
    expect(salao.json.grupo).toBe('sociais');
  });

  it('a gestão pode escolher o grupo na marcação e trocar depois', async () => {
    const predio = await novoLoteamento('Residencial com grupo escolhido');
    const r = await req('POST', `/predios/${predio}/lazer`, { categoria: 'outro', grupo: 'pet', nome: 'Pet place', x: 1, z: 1 }, gestao);
    expect(r.json.grupo).toBe('pet');
    const editado = await req('PATCH', `/lazer/${r.json.id}`, { grupo: 'sociais' }, gestao);
    expect(editado.json.grupo).toBe('sociais');
    const lista = (await req('GET', `/predios/${predio}/lazer`, undefined, gestao)).json;
    expect(lista[0].grupo).toBe('sociais');
  });
});

describe('terreno e infraestrutura do loteamento (Plano 12d, item 8)', () => {
  it('sem layers de terreno no DXF: a rota devolve tudo vazio, sem erro', async () => {
    const predio = await novoLoteamento('Residencial sem terreno');
    const t = (await req('GET', `/predios/${predio}/terreno`, undefined, gestao)).json;
    expect(t).toEqual({ ruas: [], calcadas: [], meioFio: [], curvas: [], avisos: [] });
  });

  it('com RUAS/CALCADAS/MEIO_FIO no DXF: a importação guarda o terreno, e a rota devolve as linhas em lon/lat', async () => {
    const predio = await novoLoteamento('Residencial com terreno', true);
    const t = (await req('GET', `/predios/${predio}/terreno`, undefined, gestao)).json;
    expect(t.ruas).toHaveLength(1);
    expect(t.calcadas).toHaveLength(1);
    expect(t.meioFio).toHaveLength(1);
    const [lon, lat] = t.ruas[0][0];
    expect(lat).toBeGreaterThan(-23.6);
    expect(lat).toBeLessThan(-23.5);
    expect(lon).toBeGreaterThan(-46.7);
    expect(lon).toBeLessThan(-46.6);
  });

  it('outra empresa não vê o terreno (RLS); prédio inexistente dá 404', async () => {
    const predio = await novoLoteamento('Residencial terreno privado', true);
    const outra = await adminComMfa('concorrente12d', 'gestora@concorrente12d.com');
    expect((await req('GET', `/predios/${predio}/terreno`, undefined, outra)).status).toBe(404);
    expect((await req('GET', `/predios/00000000-0000-4000-8000-000000000000/terreno`, undefined, gestao)).status).toBe(404);
  });
});
