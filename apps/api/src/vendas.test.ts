import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { codigoTotp } from './auth/totp';
import { hashSenha } from './auth/senha';
import { hashToken } from './auth/hash';
import { ArmazenamentoLocal } from './arquivos/armazenamento';
import type { ServicosMapa } from './mapa/osm';
import type { Config } from './config';

// Banco próprio deste arquivo (os arquivos de teste rodam em paralelo).
const OWNER = process.env.TEST_API4_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_4';
const APP = process.env.TEST_API4_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_4';
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const config: Config = {
  DATABASE_URL: APP,
  JWT_SECRET: SEGREDO,
  TOTP_KEY: randomBytes(32).toString('base64url'),
  PORT: 0,
  CORS_ORIGIN: 'http://localhost:3000',
  WEB_URL: 'http://localhost:3000',
  RATE_LIMIT_AUTH: 1000,
  TRUST_PROXY: true,
  AMBIENTE: 'teste',
  WEBHOOK_PERMITIR_LOCAL: false,
};
const SENHA = 'senha-forte-123';
const CONSENTIMENTO = 'Autorizo a Construtora a usar meu nome e contato para falar comigo sobre este empreendimento.';

const mapaFalso: ServicosMapa = {
  buscarEndereco: async () => [],
  buscarPois: async () => [],
  buscarPredios: async () => [{ osmId: 'way/1', alturaM: 30, contorno: [[-46.6566, -23.5612], [-46.6565, -23.5612], [-46.6565, -23.5613]] }],
};

let app: FastifyInstance;
let pool: pg.Pool;
let owner: pg.Pool;
let pasta: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resp = { status: number; json: any };
async function req(method: 'GET' | 'POST' | 'PATCH', url: string, body?: object, token?: string, ip = '203.0.113.7'): Promise<Resp> {
  const r = await app.inject({
    method,
    url,
    payload: body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': ip, 'user-agent': 'Teste/1.0 (celular)' },
  });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : undefined };
}

async function adminComMfa(slug: string, email: string): Promise<string> {
  await req('POST', '/auth/registro', { empresa: { nome: `Construtora ${slug}`, slug }, nome: 'Gestora', email, senha: SENHA });
  const l = await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug });
  const at = await req('POST', '/auth/mfa/ativar', {}, l.json.acesso);
  return (await req('POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l.json.acesso)).json.acesso;
}

async function membro(slug: string, email: string, nome: string, papel: string): Promise<string> {
  const t = await owner.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [slug]);
  const u = await owner.query<{ id: string }>('INSERT INTO users (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id', [nome, email, await hashSenha(SENHA)]);
  await owner.query('INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, $3)', [t.rows[0]!.id, u.rows[0]!.id, papel]);
  return (await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug })).json.acesso;
}

const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre A;1;101;Tipo 2Q;72;2;650.000,00;disponivel', 'Torre A;1;102;Tipo 3Q;98;3;890.000,00;vendido', 'Torre B;1;B1;Tipo 2Q;72;2;600.000,00;disponivel'].join('\n');

let gestao = '';
let ana = '';
let bia = '';
let visitante = '';
let concorrente = '';
let projeto = '';
let torreA = '';
let torreB = '';
let u101 = '';
let u102 = '';
let uB1 = '';

beforeAll(async () => {
  await resetarBanco(OWNER);
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  pasta = await mkdtemp(join(tmpdir(), 'imersa-vendas-'));
  app = await construirApp({ pool, config, armazenamento: new ArmazenamentoLocal(pasta, 'http://api.teste', SEGREDO), mapa: mapaFalso });
  gestao = await adminComMfa('construtora', 'gestora@c.com');
  ana = await membro('construtora', 'ana@c.com', 'Ana Corretora', 'consultora');
  bia = await membro('construtora', 'bia@c.com', 'Bia Corretora', 'consultora');
  visitante = await membro('construtora', 'viewer@c.com', 'Só Vê', 'viewer');
  concorrente = await adminComMfa('concorrente', 'gestora@x.com');
  projeto = (await req('POST', '/projetos', { nome: 'Residencial Paulista' }, gestao)).json.id;
  await owner.query('UPDATE projects SET geom = ST_SetSRID(ST_MakePoint(-46.6565, -23.5613), 4326) WHERE id = $1', [projeto]);
  expect((await req('POST', `/projetos/${projeto}/importacao`, { csv: PLANILHA, aplicar: true }, gestao)).status).toBe(200);
  const det = (await req('GET', `/projetos/${projeto}`, undefined, gestao)).json;
  torreA = det.predios.find((p: { nome: string }) => p.nome === 'Torre A').id;
  torreB = det.predios.find((p: { nome: string }) => p.nome === 'Torre B').id;
  const unidades = (await owner.query<{ id: string; codigo: string }>('SELECT id, codigo FROM units')).rows;
  u101 = unidades.find((u) => u.codigo === '101')!.id;
  u102 = unidades.find((u) => u.codigo === '102')!.id;
  uB1 = unidades.find((u) => u.codigo === 'B1')!.id;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await owner?.end();
  await rm(pasta, { recursive: true, force: true });
});

const novoLink = async (token: string, predio = torreA, corpo: object = {}) => req('POST', `/predios/${predio}/links`, corpo, token);
const tokenDe = (url: string) => url.split('/v/')[1]!;

describe('links para clientes', () => {
  it('consultora gera link com token forte; o banco guarda só o hash', async () => {
    const r = await novoLink(ana, torreA, { titulo: 'Família Souza', dias: 15 });
    expect(r.status).toBe(201);
    expect(r.json.url).toMatch(/^http:\/\/localhost:3000\/v\/[\w-]{43}$/);
    const token = tokenDe(r.json.url);
    expect(Buffer.from(token, 'base64url').length).toBeGreaterThanOrEqual(16); // ≥ 128 bits
    const salvo = (await owner.query<{ token_hash: string; expira_em: Date }>('SELECT token_hash, expira_em FROM share_links WHERE id = $1', [r.json.id])).rows[0]!;
    expect(salvo.token_hash).toBe(hashToken(token));
    expect(JSON.stringify(salvo)).not.toContain(token);
    const dias = (salvo.expira_em.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(14.9);
    expect(dias).toBeLessThanOrEqual(15);
  });

  it('quem só vê não gera link; outra empresa não acha o prédio; validade fora de 1–90 é recusada', async () => {
    expect((await novoLink(visitante)).status).toBe(403);
    expect((await novoLink(concorrente)).status).toBe(404);
    expect((await novoLink(ana, torreA, { dias: 91 })).status).toBe(400);
    expect((await novoLink(ana, torreA, { dias: 0 })).status).toBe(400);
  });

  it('consultora vê e revoga só os próprios links; gestão vê e revoga todos', async () => {
    const daBia = (await novoLink(bia, torreA, { titulo: 'Cliente da Bia' })).json;
    const listaAna = (await req('GET', `/predios/${torreA}/links`, undefined, ana)).json;
    expect(listaAna.every((l: { criadoPor: { nome: string } }) => l.criadoPor.nome === 'Ana Corretora')).toBe(true);
    expect(listaAna.some((l: { id: string }) => l.id === daBia.id)).toBe(false);
    const listaGestao = (await req('GET', `/predios/${torreA}/links`, undefined, gestao)).json;
    expect(listaGestao.some((l: { id: string }) => l.id === daBia.id)).toBe(true);
    expect(listaGestao[0]).toMatchObject({ status: 'ativo', visitas: 0, leads: 0 });
    expect((await req('POST', `/links/${daBia.id}/revogar`, {}, ana)).status).toBe(404);
    expect((await req('POST', `/links/${daBia.id}/revogar`, {}, gestao)).status).toBe(200);
    expect((await req('GET', `/predios/${torreA}/links`, undefined, bia)).json.find((l: { id: string }) => l.id === daBia.id).status).toBe('revogado');
    expect((await req('GET', `/predios/${torreA}/links`, undefined, concorrente)).status).toBe(404);
  });
});

describe('portal público (sem login)', () => {
  it('abre o prédio do link com empresa, consultora e unidades; sem dados internos', async () => {
    const { url } = (await novoLink(ana)).json;
    const r = await req('GET', `/publico/links/${tokenDe(url)}`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      empresa: { nome: 'Construtora construtora' },
      consultora: { nome: 'Ana Corretora' },
      projeto: { nome: 'Residencial Paulista', lat: -23.5613, lon: -46.6565 },
      predio: { id: torreA, nome: 'Torre A' },
      modeloUrl: null,
      interiores: [],
    });
    expect(r.json.unidades.map((u: { codigo: string }) => u.codigo).sort()).toEqual(['101', '102']);
    expect(r.json.unidades[0]).toEqual(expect.objectContaining({ andar: 1, areaM2: 72, quartos: 2 }));
    const texto = JSON.stringify(r.json);
    for (const proibido of ['transicoes', 'tenant', 'email', 'token', 'gestora@c.com']) expect(texto).not.toContain(proibido);
  });

  it('desconhecido → 404; revogado → 410; vencido → 410', async () => {
    expect((await req('GET', `/publico/links/${randomBytes(32).toString('base64url')}`)).status).toBe(404);
    expect((await req('GET', '/publico/links/curto')).status).toBe(404);
    const revogado = (await novoLink(ana)).json;
    await req('POST', `/links/${revogado.id}/revogar`, {}, ana);
    const r = await req('GET', `/publico/links/${tokenDe(revogado.url)}`);
    expect(r.status).toBe(410);
    expect(r.json.erro).toBe('link_indisponivel');
    const vencido = (await novoLink(ana)).json;
    await owner.query("UPDATE share_links SET expira_em = now() - interval '1 minute' WHERE id = $1", [vencido.id]);
    expect((await req('GET', `/publico/links/${tokenDe(vencido.url)}`)).status).toBe(410);
    expect((await req('POST', `/publico/links/${tokenDe(vencido.url)}/eventos`, { sessao: randomUUID(), eventos: [{ tipo: 'abriu' }] })).status).toBe(410);
  });

  it('entorno do empreendimento pelo link', async () => {
    const { url } = (await novoLink(ana)).json;
    const r = await req('GET', `/publico/links/${tokenDe(url)}/entorno`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ semLocalizacao: false, centro: { lat: -23.5613, lon: -46.6565 } });
    expect(r.json.predios).toHaveLength(1);
  });

  it('arquivo só do próprio projeto, pronto e de tipo 3D', async () => {
    const { url } = (await novoLink(ana)).json;
    const t = tokenDe(url);
    const tenant = (await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'construtora'")).rows[0]!.id;
    const outroProjeto = (await req('POST', '/projetos', { nome: 'Outro' }, gestao)).json.id;
    const inserir = async (projetoId: string, tipo: string, status: string) =>
      (
        await owner.query<{ id: string }>(
          `INSERT INTO assets (tenant_id, project_id, tipo, nome, chave, tamanho_declarado, tamanho, sha256, status, verificado_antivirus)
           VALUES ($1, $2, $3, 'sala.spz', 'x/' || gen_random_uuid() || '/sala.spz', 10, 10, repeat('a', 64), $4, false) RETURNING id`,
          [tenant, projetoId, tipo, status],
        )
      ).rows[0]!.id;
    const sala = await inserir(projeto, 'splat', 'pronto');
    const doOutro = await inserir(outroProjeto, 'splat', 'pronto');
    const emRevisao = await inserir(projeto, 'splat', 'em_revisao');
    const planta = await inserir(projeto, 'planta', 'pronto');
    const ok = await req('GET', `/publico/links/${t}/arquivos/${sala}`);
    expect(ok.status).toBe(200);
    expect(ok.json.url).toContain('http://api.teste/');
    for (const id of [doOutro, emRevisao, planta, randomUUID()]) expect((await req('GET', `/publico/links/${t}/arquivos/${id}`)).status).toBe(404);
    expect((await req('GET', `/publico/links/${t}`)).json.interiores).toEqual([{ id: sala, nome: 'sala.spz' }]);
  });
});

describe('lead (LGPD)', () => {
  it('sem consentimento não grava nada', async () => {
    const { url } = (await novoLink(ana)).json;
    const antes = Number((await owner.query('SELECT count(*) FROM leads')).rows[0].count);
    const sem = await req('POST', `/publico/links/${tokenDe(url)}/leads`, { nome: 'Carlos', telefone: '11 99999-0000', consentimento: false, textoConsentimento: CONSENTIMENTO });
    expect(sem.status).toBe(400);
    expect(sem.json.erro).toBe('consentimento_obrigatorio');
    const semCampo = await req('POST', `/publico/links/${tokenDe(url)}/leads`, { nome: 'Carlos', telefone: '11 99999-0000', textoConsentimento: CONSENTIMENTO });
    expect(semCampo.status).toBe(400);
    expect((await req('POST', `/publico/links/${tokenDe(url)}/leads`, { nome: 'Carlos', consentimento: true, textoConsentimento: CONSENTIMENTO })).status).toBe(400); // sem contato
    expect(Number((await owner.query('SELECT count(*) FROM leads')).rows[0].count)).toBe(antes);
    // o banco também recusa, mesmo se a API errasse
    const link = (await owner.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM share_links LIMIT 1')).rows[0]!;
    await expect(
      owner.query("INSERT INTO leads (tenant_id, link_id, nome, telefone, consentimento, texto_consentimento) VALUES ($1, $2, 'X Y', '1', false, $3)", [link.tenant_id, link.id, CONSENTIMENTO]),
    ).rejects.toThrow(/check/);
  });

  it('com consentimento grava base legal, texto aceito, data, IP e navegador; vai para a consultora do link', async () => {
    const { url } = (await novoLink(ana)).json;
    const r = await req(
      'POST',
      `/publico/links/${tokenDe(url)}/leads`,
      { nome: 'Carlos Lima', telefone: '(11) 98888-7777', email: 'Carlos@Email.com', mensagem: 'Gostei da 101', unidadeId: u101, consentimento: true, textoConsentimento: CONSENTIMENTO },
      undefined,
      '198.51.100.23',
    );
    expect(r.status).toBe(201);
    const salvo = (await owner.query('SELECT * FROM leads WHERE id = $1', [r.json.id])).rows[0];
    expect(salvo).toMatchObject({ nome: 'Carlos Lima', email: 'carlos@email.com', base_legal: 'consentimento', consentimento: true, texto_consentimento: CONSENTIMENTO, ip: '198.51.100.23', navegador: 'Teste/1.0 (celular)', status: 'novo', unit_id: u101 });
    expect(Date.now() - new Date(salvo.criado_em).getTime()).toBeLessThan(60_000);

    const daAna = (await req('GET', '/leads', undefined, ana)).json;
    expect(daAna.find((l: { id: string }) => l.id === r.json.id)).toMatchObject({ nome: 'Carlos Lima', telefone: '(11) 98888-7777', unidade: '101', predio: 'Torre A', consultora: 'Ana Corretora', status: 'novo' });
    expect((await req('GET', '/leads', undefined, bia)).json.some((l: { id: string }) => l.id === r.json.id)).toBe(false);
    expect((await req('GET', '/leads', undefined, gestao)).json.some((l: { id: string }) => l.id === r.json.id)).toBe(true);
    expect((await req('GET', '/leads', undefined, concorrente)).json).toEqual([]);
    expect((await req('GET', '/leads', undefined, visitante)).status).toBe(403);

    expect((await req('PATCH', `/leads/${r.json.id}`, { status: 'em_contato' }, bia)).status).toBe(404);
    expect((await req('PATCH', `/leads/${r.json.id}`, { status: 'em_contato' }, ana)).json.status).toBe('em_contato');
    expect((await req('PATCH', `/leads/${r.json.id}`, { status: 'qualquer' }, ana)).status).toBe(400);
  });

  it('unidade de outro prédio é ignorada (não pendura dado fora do link)', async () => {
    const { url } = (await novoLink(ana)).json;
    const r = await req('POST', `/publico/links/${tokenDe(url)}/leads`, { nome: 'Dora', email: 'd@d.com', unidadeId: uB1, consentimento: true, textoConsentimento: CONSENTIMENTO });
    expect(r.status).toBe(201);
    expect((await owner.query('SELECT unit_id FROM leads WHERE id = $1', [r.json.id])).rows[0].unit_id).toBeNull();
  });
});

describe('eventos e números', () => {
  it('números batem com os eventos brutos; consultora vê só os dela; anonimização mantém os totais', async () => {
    const p2 = (await req('POST', '/projetos', { nome: 'Vila Nova' }, gestao)).json.id;
    await req('POST', `/projetos/${p2}/importacao`, { csv: PLANILHA.replaceAll('Torre', 'Bloco'), aplicar: true }, gestao);
    const blocoA = (await req('GET', `/projetos/${p2}`, undefined, gestao)).json.predios.find((p: { nome: string }) => p.nome === 'Bloco A').id;
    const unidadesP2 = (await owner.query<{ id: string; codigo: string }>('SELECT u.id, u.codigo FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.project_id = $1', [p2])).rows;
    const v101 = unidadesP2.find((u) => u.codigo === '101')!.id;
    const v102 = unidadesP2.find((u) => u.codigo === '102')!.id;

    const linkAna = tokenDe((await novoLink(ana, blocoA)).json.url);
    const linkBia = tokenDe((await novoLink(bia, blocoA)).json.url);
    const ev = (t: string, eventos: object[]) => req('POST', `/publico/links/${t}/eventos`, { sessao: randomUUID(), eventos });
    expect((await ev(linkAna, [{ tipo: 'abriu' }, { tipo: 'unidade', unidadeId: v101 }, { tipo: 'unidade', unidadeId: v102 }, { tipo: 'favorito', unidadeId: v101 }, { tipo: 'tempo', duracaoS: 120 }])).status).toBe(204);
    await ev(linkAna, [{ tipo: 'abriu' }, { tipo: 'unidade', unidadeId: v101 }, { tipo: 'tempo', duracaoS: 60 }]);
    await ev(linkBia, [{ tipo: 'abriu' }, { tipo: 'interior' }, { tipo: 'tempo', duracaoS: 30 }]);
    // unidade de outro empreendimento: o evento fica sem unidade
    await ev(linkBia, [{ tipo: 'unidade', unidadeId: u101 }]);
    await req('POST', `/publico/links/${linkAna}/leads`, { nome: 'Lead Um', email: 'l1@x.com', consentimento: true, textoConsentimento: CONSENTIMENTO });
    expect((await ev(linkAna, [{ tipo: 'invalido' }])).status).toBe(400);
    expect((await ev(linkAna, Array.from({ length: 51 }, () => ({ tipo: 'abriu' })))).status).toBe(400);

    const bruto = (await owner.query<{ tipo: string; n: number }>(
      `SELECT e.tipo, count(*)::int AS n FROM view_events e JOIN share_links l ON l.id = e.link_id JOIN buildings b ON b.id = l.building_id WHERE b.project_id = $1 GROUP BY e.tipo`,
      [p2],
    )).rows;
    const n = (tipo: string) => bruto.find((b) => b.tipo === tipo)?.n ?? 0;

    const g = (await req('GET', `/projetos/${p2}/numeros?dias=30`, undefined, gestao)).json;
    expect(g).toMatchObject({ dias: 30, visitas: n('abriu'), interiores: n('interior'), leads: 1, tempoMedioS: 70 });
    expect(g.visitas).toBe(3);
    expect(g.conversao).toBeCloseTo(1 / 3);
    expect(g.unidades[0]).toMatchObject({ codigo: '101', vistas: 2, favoritos: 1 });
    expect(g.unidades[1]).toMatchObject({ codigo: '102', vistas: 1, favoritos: 0 });
    expect(g.porConsultora).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nome: 'Ana Corretora', links: 1, visitas: 2, leads: 1 }),
        expect.objectContaining({ nome: 'Bia Corretora', links: 1, visitas: 1, leads: 0 }),
      ]),
    );

    const a = (await req('GET', `/projetos/${p2}/numeros?dias=30`, undefined, ana)).json;
    expect(a).toMatchObject({ visitas: 2, leads: 1 });
    expect(a.porConsultora).toHaveLength(1);
    expect((await req('GET', `/projetos/${p2}/numeros`, undefined, concorrente)).status).toBe(404);
    expect((await req('GET', `/projetos/${p2}/numeros`, undefined, visitante)).status).toBe(403);

    // retenção: eventos antigos perdem IP/navegador/sessão, os totais continuam
    await owner.query("UPDATE view_events SET criado_em = now() - interval '200 days' WHERE link_id IN (SELECT id FROM share_links WHERE building_id = $1)", [blocoA]);
    const anon = await pool.query<{ n: number }>('SELECT anonimizar_eventos(180) AS n');
    expect(anon.rows[0]!.n).toBeGreaterThanOrEqual(12);
    const resto = (await owner.query("SELECT count(*)::int AS n FROM view_events WHERE criado_em < now() - interval '180 days' AND (ip IS NOT NULL OR navegador IS NOT NULL OR sessao IS NOT NULL)")).rows[0];
    expect(resto.n).toBe(0);
    const antigo = (await req('GET', `/projetos/${p2}/numeros?dias=365`, undefined, gestao)).json;
    expect(antigo).toMatchObject({ visitas: 3, interiores: 1, tempoMedioS: 70 });
    await expect(pool.query('SELECT anonimizar_eventos(0)')).rejects.toThrow(/retenção/);
  });

  it('eventos guardam IP e navegador (até a anonimização)', async () => {
    const t = tokenDe((await novoLink(ana)).json.url);
    await req('POST', `/publico/links/${t}/eventos`, { sessao: randomUUID(), eventos: [{ tipo: 'abriu' }] }, undefined, '192.0.2.44');
    const e = (await owner.query("SELECT ip, navegador, anonimizado FROM view_events WHERE ip = '192.0.2.44'")).rows[0];
    expect(e).toMatchObject({ ip: '192.0.2.44', navegador: 'Teste/1.0 (celular)', anonimizado: false });
  });
});

describe('anti-abuso', () => {
  it('formulário de lead tem limite por IP', async () => {
    const t = tokenDe((await novoLink(ana)).json.url);
    const ip = '198.51.100.99';
    const envio = () => req('POST', `/publico/links/${t}/leads`, { nome: 'Spam Bot', email: 's@s.com', consentimento: true, textoConsentimento: CONSENTIMENTO }, undefined, ip);
    const status: number[] = [];
    for (let i = 0; i < 12; i++) status.push((await envio()).status);
    expect(status.filter((s) => s === 201).length).toBeLessThanOrEqual(10);
    expect(status).toContain(429);
  });
});

describe('estande de vendas (PC com tela touch)', () => {
  const tokenEstande = (url: string) => url.split('/estande/')[1]!;
  const IP = '198.51.100.9';

  it('só a gestão cria; o endereço tem token forte; o link do PC não entra na lista das consultoras', async () => {
    expect((await req('POST', `/predios/${torreA}/estandes`, { nome: 'Estande' }, ana)).status).toBe(403);
    expect((await req('POST', `/predios/${torreA}/estandes`, { nome: 'Estande' }, concorrente)).status).toBe(404);
    expect((await req('POST', `/predios/${torreA}/estandes`, { nome: '' }, gestao)).status).toBe(400);
    const r = await req('POST', `/predios/${torreA}/estandes`, { nome: 'Estande da Paulista' }, gestao);
    expect(r.status).toBe(201);
    expect(r.json.url).toMatch(/^http:\/\/localhost:3000\/estande\/[\w-]{43}$/);
    const links = (await req('GET', `/predios/${torreA}/links`, undefined, gestao)).json as Array<{ titulo: string }>;
    expect(links.some((l) => l.titulo === 'Estande: Estande da Paulista')).toBe(false);
    expect(links.some((l) => l.titulo === 'QR do estande: Estande da Paulista')).toBe(true); // o QR é link de cliente
    expect(JSON.stringify((await owner.query('SELECT * FROM share_links')).rows)).not.toContain(tokenEstande(r.json.url));
  });

  it('PC: dados do prédio pelo mesmo portal, QR estável que abre o portal, sinal de vida e comando de recarregar', async () => {
    const criado = await req('POST', `/predios/${torreA}/estandes`, { nome: 'Estande do shopping' }, gestao);
    const t = tokenEstande(criado.json.url);
    const e = await req('GET', `/publico/estandes/${t}`, undefined, undefined, IP);
    expect(e.status).toBe(200);
    expect(e.json.nome).toBe('Estande do shopping');
    expect(e.json.qrUrl).toMatch(/^http:\/\/localhost:3000\/v\/[\w-]{43}$/);
    expect((await req('GET', `/publico/estandes/${t}`, undefined, undefined, IP)).json.qrUrl).toBe(e.json.qrUrl); // o mesmo QR depois de reiniciar
    // o QR abre o portal do cliente do mesmo prédio
    const portal = await req('GET', `/publico/links/${e.json.qrUrl.split('/v/')[1]}`, undefined, undefined, IP);
    expect(portal.status).toBe(200);
    expect(portal.json.predio.id).toBe(torreA);
    expect((await req('GET', `/publico/links/${t}`, undefined, undefined, IP)).json.predio.id).toBe(torreA);
    // link de cliente comum não é estande
    expect((await req('GET', `/publico/estandes/${e.json.qrUrl.split('/v/')[1]}`, undefined, undefined, IP)).status).toBe(404);

    const lista = async () => ((await req('GET', `/predios/${torreA}/estandes`, undefined, gestao)).json as Array<{ id: string; status: string; info: object; recarregarPendente: boolean }>).find((x) => x.id === criado.json.id)!;
    expect((await lista()).status).toBe('offline');
    expect((await req('POST', `/publico/estandes/${t}/sinal`, { fps: 58, largura: 1920, altura: 1080, apresentando: true }, undefined, IP)).json).toEqual({ recarregar: false });
    expect(await lista()).toMatchObject({ status: 'online', info: { fps: 58, largura: 1920 }, recarregarPendente: false });
    expect((await req('POST', `/publico/estandes/${t}/sinal`, { fps: -1 }, undefined, IP)).status).toBe(400);

    expect((await req('POST', `/estandes/${criado.json.id}/recarregar`, {}, ana)).status).toBe(403);
    expect((await req('POST', `/estandes/${criado.json.id}/recarregar`, {}, concorrente)).status).toBe(404);
    expect((await req('POST', `/estandes/${criado.json.id}/recarregar`, {}, gestao)).status).toBe(200);
    expect((await lista()).recarregarPendente).toBe(true);
    expect((await req('POST', `/publico/estandes/${t}/sinal`, {}, undefined, IP)).json).toEqual({ recarregar: true });
    expect((await req('POST', `/publico/estandes/${t}/sinal`, {}, undefined, IP)).json).toEqual({ recarregar: false }); // uma vez só
    expect((await lista()).recarregarPendente).toBe(false);
  });

  it('desativar para o PC e o QR juntos; a outra empresa não vê', async () => {
    const criado = await req('POST', `/predios/${torreA}/estandes`, { nome: 'Estande temporário' }, gestao);
    const t = tokenEstande(criado.json.url);
    const qr = (await req('GET', `/publico/estandes/${t}`, undefined, undefined, IP)).json.qrUrl.split('/v/')[1];
    expect((await req('GET', `/predios/${torreA}/estandes`, undefined, concorrente)).status).toBe(404);
    expect((await req('POST', `/estandes/${criado.json.id}/desativar`, {}, concorrente)).status).toBe(404);
    expect((await req('POST', `/estandes/${criado.json.id}/desativar`, {}, gestao)).status).toBe(200);
    expect((await req('GET', `/publico/estandes/${t}`, undefined, undefined, IP)).status).toBe(410);
    expect((await req('POST', `/publico/estandes/${t}/sinal`, {}, undefined, IP)).status).toBe(410);
    expect((await req('GET', `/publico/links/${qr}`, undefined, undefined, IP)).status).toBe(410);
    expect((await req('POST', `/estandes/${criado.json.id}/recarregar`, {}, gestao)).status).toBe(404);
    const e = ((await req('GET', `/predios/${torreA}/estandes`, undefined, gestao)).json as Array<{ id: string; status: string }>).find((x) => x.id === criado.json.id)!;
    expect(e.status).toBe('desativado');
  });

  it('pacote para o Unreal: empreendimento georreferenciado, unidades com a peça do modelo e as rotas ao vivo', async () => {
    expect((await req('GET', `/predios/${torreA}/pacote-unreal`, undefined, ana)).status).toBe(403);
    const r = await req('GET', `/predios/${torreA}/pacote-unreal`, undefined, gestao);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ formato: 'imersa-estande/1', predio: { id: torreA, nome: 'Torre A' }, empreendimento: { nome: 'Residencial Paulista' }, modelo: null });
    expect(r.json.empreendimento.lat).toBeCloseTo(-23.5613, 4);
    expect(r.json.unidades.map((u: { codigo: string }) => u.codigo)).toEqual(['101', '102']);
    expect(r.json.unidades[0]).toMatchObject({ andar: 1, status: 'disponivel', quartos: 2, areaM2: 72, meshNodeId: null });
    expect(r.json.tempoReal.aoVivo).toContain('/publico/links/{token}/ao-vivo');
    // sem modelo 3D ligado ao prédio, não há o que baixar
    expect((await req('GET', `/predios/${torreA}/pacote-unreal/modelo.glb`, undefined, gestao)).status).toBe(404);
  });
});
