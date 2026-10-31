import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { codigoTotp } from './auth/totp';
import { hashSenha } from './auth/senha';
import { ArmazenamentoLocal } from './arquivos/armazenamento';
import type { Antivirus } from './arquivos/antivirus';
import type { ServicosMapa } from './mapa/osm';
import type { Config } from './config';

// Banco próprio deste arquivo (os arquivos de teste rodam em paralelo).
const OWNER = process.env.TEST_API3_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_3';
const APP = process.env.TEST_API3_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_3';
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const config: Config = {
  DATABASE_URL: APP,
  JWT_SECRET: SEGREDO,
  TOTP_KEY: randomBytes(32).toString('base64url'),
  PORT: 0,
  CORS_ORIGIN: 'http://localhost:3000',
  WEB_URL: 'http://localhost:3000',
  RATE_LIMIT_AUTH: 1000,
  TRUST_PROXY: false,
  AMBIENTE: 'teste',
};
const SENHA = 'senha-forte-123';

/** Antivírus falso: acusa qualquer conteúdo com a assinatura de teste EICAR. */
const antivirusFalso: Antivirus = {
  async verificar(conteudo) {
    let texto = '';
    for await (const p of conteudo) texto += Buffer.from(p as Uint8Array).toString('latin1');
    return texto.includes('EICAR') ? { verificado: true, limpo: false, ameaca: 'Eicar-Test-Signature' } : { verificado: true, limpo: true };
  },
};
let mapaFora = false;
const mapaFalso: ServicosMapa = {
  async buscarEndereco(texto) {
    if (mapaFora) throw new Error('fora do ar');
    return [{ rotulo: `${texto}, São Paulo`, lat: -23.5613, lon: -46.6565 }];
  },
  async buscarPois() {
    if (mapaFora) throw new Error('fora do ar');
    return [
      { osmId: 'way/2', categoria: 'parque', nome: 'Parque Trianon', lat: -23.5636, lon: -46.6585 },
      { osmId: 'node/1', categoria: 'transporte', nome: 'Estação Trianon-MASP', lat: -23.5614, lon: -46.6564 },
      { osmId: 'node/3', categoria: 'escola', nome: 'Colégio Dante Alighieri', lat: -23.5672, lon: -46.6555 },
    ];
  },
  async buscarPredios(lat, lon) {
    chamadasPredios++;
    if (mapaFora) throw new Error('fora do ar');
    return [{ osmId: 'way/7', alturaM: 60, contorno: [[lon, lat], [lon + 0.0001, lat], [lon + 0.0001, lat + 0.0001]] }];
  },
};
let chamadasPredios = 0;

let app: FastifyInstance;
let pool: pg.Pool;
let owner: pg.Pool;
let pasta = '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resp = { status: number; json: any };
async function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: object, token?: string): Promise<Resp> {
  const r = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : undefined };
}
async function enviar(url: string, conteudo: Buffer) {
  const u = new URL(url);
  const r = await app.inject({ method: 'PUT', url: `${u.pathname}${u.search}`, payload: conteudo, headers: { 'content-type': 'application/octet-stream' } });
  return { status: r.statusCode, json: r.json() };
}
async function adminComMfa(slug: string, email: string): Promise<string> {
  await req('POST', '/auth/registro', { empresa: { nome: `Empresa ${slug}`, slug }, nome: 'Admin', email, senha: SENHA });
  const l = await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug });
  const at = await req('POST', '/auth/mfa/ativar', {}, l.json.acesso);
  return (await req('POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l.json.acesso)).json.acesso;
}

const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(60, 1)]);
let admin = '';
let outra = '';
let consultora = '';
let projeto = '';

beforeAll(async () => {
  await resetarBanco(OWNER);
  pasta = await mkdtemp(join(tmpdir(), 'imersa-api-arquivos-'));
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  app = await construirApp({ pool, config, armazenamento: new ArmazenamentoLocal(pasta, 'http://api.teste', SEGREDO), antivirus: antivirusFalso, mapa: mapaFalso });
  admin = await adminComMfa('construtora', 'admin@c.com');
  outra = await adminComMfa('concorrente', 'admin@x.com');
  const t = await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'construtora'");
  const u = await owner.query<{ id: string }>("INSERT INTO users (nome, email, senha_hash) VALUES ('C', 'c@c.com', $1) RETURNING id", [await hashSenha(SENHA)]);
  await owner.query("INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, 'consultora')", [t.rows[0]!.id, u.rows[0]!.id]);
  consultora = (await req('POST', '/auth/login', { email: 'c@c.com', senha: SENHA, empresa: 'construtora' })).json.acesso;
  projeto = (await req('POST', '/projetos', { nome: 'Residencial' }, admin)).json.id;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await owner.end();
  await rm(pasta, { recursive: true, force: true });
});

describe('arquivos', () => {
  let glb = '';

  it('envio completo: declara → envia pelo link assinado → verificado → pronto → download idêntico', async () => {
    const d = await req('POST', `/projetos/${projeto}/arquivos`, { nome: 'Casa FZK.glb', tipo: 'modelo_3d', tamanho: GLB.length }, admin);
    expect(d.status).toBe(201);
    glb = d.json.id;
    expect(await enviar(d.json.envio.url, GLB)).toEqual({ status: 200, json: { status: 'pronto', motivo: null } });
    const lista = (await req('GET', `/projetos/${projeto}/arquivos`, undefined, consultora)).json;
    expect(lista[0]).toMatchObject({ id: glb, nome: 'Casa FZK.glb', tipo: 'modelo_3d', status: 'pronto', tamanho: GLB.length, verificadoAntivirus: true });
    const dl = await req('GET', `/arquivos/${glb}/download`, undefined, consultora);
    const u = new URL(dl.json.url);
    const r = await app.inject({ method: 'GET', url: `${u.pathname}${u.search}` });
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.equals(GLB)).toBe(true);
    expect(r.headers['content-type']).toBe('model/gltf-binary');
  });

  it('CORS: o navegador do site pode fazer o PUT direto (pré-checagem libera o método)', async () => {
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/arquivos/00000000-0000-4000-8000-000000000000/conteudo',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
    });
    expect(r.statusCode).toBe(204);
    expect(r.headers['access-control-allow-methods']).toContain('PUT');
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('o mesmo link não serve para enviar de novo', async () => {
    const d = await req('POST', `/projetos/${projeto}/arquivos`, { nome: 'b.glb', tipo: 'modelo_3d', tamanho: GLB.length }, admin);
    await enviar(d.json.envio.url, GLB);
    expect((await enviar(d.json.envio.url, GLB)).status).toBe(409);
  });

  it('conteúdo que não é o que diz ser → rejeitado e apagado', async () => {
    const d = await req('POST', `/projetos/${projeto}/arquivos`, { nome: 'falso.glb', tipo: 'modelo_3d', tamanho: 100 }, admin);
    expect((await enviar(d.json.envio.url, Buffer.from('MZ executável'))).json).toEqual({ status: 'rejeitado', motivo: 'o conteúdo não corresponde ao tipo do arquivo' });
    expect((await req('GET', `/arquivos/${d.json.id}/download`, undefined, admin)).status).toBe(404);
  });

  it('antivírus acusa → rejeitado', async () => {
    const pdf = Buffer.from('%PDF-1.7 X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
    const d = await req('POST', `/projetos/${projeto}/arquivos`, { nome: 'planta.pdf', tipo: 'planta', tamanho: pdf.length }, admin);
    expect((await enviar(d.json.envio.url, pdf)).json.motivo).toBe('ameaça encontrada pelo antivírus: Eicar-Test-Signature');
  });

  it('maior que o declarado → 413 e rejeitado', async () => {
    const d = await req('POST', `/projetos/${projeto}/arquivos`, { nome: 'p.glb', tipo: 'modelo_3d', tamanho: 10 }, admin);
    expect((await enviar(d.json.envio.url, GLB)).status).toBe(413);
    const item = (await req('GET', `/projetos/${projeto}/arquivos`, undefined, admin)).json.find((a: { id: string }) => a.id === d.json.id);
    expect(item.status).toBe('rejeitado');
  });

  it('link adulterado ou de outra empresa → 403; extensão errada → 400; consultora não envia', async () => {
    const d = await req('POST', `/projetos/${projeto}/arquivos`, { nome: 'c.glb', tipo: 'modelo_3d', tamanho: GLB.length }, admin);
    const u = new URL(d.json.envio.url);
    u.searchParams.set('sig', 'x'.repeat(43));
    expect((await enviar(u.toString(), GLB)).status).toBe(403);
    const outraEmpresa = (await req('GET', '/me', undefined, outra)).json.tenantId;
    const v = new URL(d.json.envio.url);
    v.searchParams.set('t', outraEmpresa);
    expect((await enviar(v.toString(), GLB)).status).toBe(403);
    expect((await req('POST', `/projetos/${projeto}/arquivos`, { nome: 'x.exe', tipo: 'documento', tamanho: 10 }, admin)).json.erro).toBe('arquivo_invalido');
    expect((await req('POST', `/projetos/${projeto}/arquivos`, { nome: 'x.glb', tipo: 'modelo_3d', tamanho: 10 }, consultora)).status).toBe(403);
  });

  it('outra empresa não vê nem baixa', async () => {
    expect((await req('GET', `/projetos/${projeto}/arquivos`, undefined, outra)).status).toBe(404);
    expect((await req('GET', `/arquivos/${glb}/download`, undefined, outra)).status).toBe(404);
  });

  it('modelo 3D do prédio e vínculo de peças às unidades', async () => {
    const predio = (await req('POST', `/projetos/${projeto}/predios`, { nome: 'Torre A', andares: 1 }, admin)).json.id;
    const u1 = (await req('POST', `/predios/${predio}/unidades`, { codigo: '101', andar: 1 }, admin)).json.id;
    const u2 = (await req('POST', `/predios/${predio}/unidades`, { codigo: '102', andar: 1 }, admin)).json.id;
    const pdf = (await req('GET', `/projetos/${projeto}/arquivos`, undefined, admin)).json.find((a: { tipo: string }) => a.tipo === 'planta').id;
    expect((await req('PATCH', `/predios/${predio}/modelo`, { arquivoId: pdf }, admin)).json.erro).toBe('arquivo_invalido_para_modelo');
    expect((await req('PATCH', `/predios/${predio}/modelo`, { arquivoId: glb }, admin)).status).toBe(200);
    expect((await req('PATCH', `/unidades/${u1}`, { meshNodeId: 'product-1-body' }, admin)).status).toBe(200);
    expect((await req('PATCH', `/unidades/${u2}`, { meshNodeId: 'product-1-body' }, admin)).json.erro).toBe('no_3d_em_uso');
    const e = (await req('GET', `/predios/${predio}`, undefined, consultora)).json;
    expect(e.predio.modeloArquivoId).toBe(glb);
    expect(e.andares[0].unidades.map((u: { codigo: string; meshNodeId: string | null }) => [u.codigo, u.meshNodeId])).toEqual([
      ['101', 'product-1-body'],
      ['102', null],
    ]);

    expect((await req('DELETE', `/arquivos/${glb}`, undefined, admin)).status).toBe(204);
    expect((await req('GET', `/predios/${predio}`, undefined, admin)).json.predio.modeloArquivoId).toBeNull();
  });

  it('limite de armazenamento da empresa', async () => {
    const pequeno = await construirApp({ pool, config: { ...config, LIMITE_ARMAZENAMENTO_GB: 1 / 1024 ** 2 }, armazenamento: new ArmazenamentoLocal(pasta, 'http://api.teste', SEGREDO), antivirus: antivirusFalso, mapa: mapaFalso });
    const r = await pequeno.inject({ method: 'POST', url: `/projetos/${projeto}/arquivos`, payload: { nome: 'g.glb', tipo: 'modelo_3d', tamanho: 2 * 1024 * 1024 }, headers: { authorization: `Bearer ${admin}` } });
    expect([r.statusCode, r.json().erro]).toEqual([413, 'limite_armazenamento']);
    await pequeno.close();
  });
});

describe('localização e arredores', () => {
  it('sem localização: lista vazia avisando, e importar do OSM é recusado', async () => {
    expect((await req('GET', `/projetos/${projeto}/pois`, undefined, admin)).json).toEqual({ semLocalizacao: true, pois: [] });
    expect((await req('POST', `/projetos/${projeto}/pois/osm`, {}, admin)).json.erro).toBe('sem_localizacao');
  });

  it('busca de endereço (só gestão; serviço fora do ar vira 502)', async () => {
    expect((await req('GET', `/geocodificar?q=${encodeURIComponent('Av. Paulista, 1000')}`, undefined, admin)).json).toEqual([
      { rotulo: 'Av. Paulista, 1000, São Paulo', lat: -23.5613, lon: -46.6565 },
    ]);
    expect((await req('GET', '/geocodificar?q=Paulista', undefined, consultora)).status).toBe(403);
    mapaFora = true;
    expect((await req('GET', '/geocodificar?q=Paulista', undefined, admin)).status).toBe(502);
    mapaFora = false;
  });

  it('importa do OSM sem duplicar, ordena por distância e estima tempo a pé', async () => {
    await req('PATCH', `/projetos/${projeto}`, { lat: -23.56175, lon: -46.6545 }, admin);
    expect((await req('POST', `/projetos/${projeto}/pois/osm`, { raioM: 1000 }, admin)).json).toEqual({ encontrados: 3, novos: 3 });
    expect((await req('POST', `/projetos/${projeto}/pois/osm`, { raioM: 1000 }, admin)).json).toEqual({ encontrados: 3, novos: 0 });
    const r = (await req('GET', `/projetos/${projeto}/pois`, undefined, consultora)).json;
    expect(r.semLocalizacao).toBe(false);
    // Distâncias reais: estação ~198 m, parque ~457 m, colégio ~612 m.
    expect(r.pois.map((p: { nome: string }) => p.nome)).toEqual(['Estação Trianon-MASP', 'Parque Trianon', 'Colégio Dante Alighieri']);
    const estacao = r.pois[0];
    expect(estacao.distanciaM).toBeGreaterThan(150);
    expect(estacao.distanciaM).toBeLessThan(300);
    expect(estacao.minutosAPe).toBe(Math.ceil(estacao.distanciaM / 80));
  });

  it('ponto manual, exclusão e isolamento', async () => {
    const m = await req('POST', `/projetos/${projeto}/pois`, { categoria: 'mercado', nome: 'Mercado do bairro', lat: -23.562, lon: -46.655 }, admin);
    expect(m.status).toBe(201);
    expect((await req('DELETE', `/pois/${m.json.id}`, undefined, outra)).status).toBe(404);
    expect((await req('DELETE', `/pois/${m.json.id}`, undefined, admin)).status).toBe(204);
    expect((await req('GET', `/projetos/${projeto}/pois`, undefined, outra)).status).toBe(404);
  });
});

describe('entorno: prédios reais do OSM em volta (com cache)', () => {
  let p = '';
  beforeAll(async () => {
    p = (await req('POST', '/projetos', { nome: 'Torre com entorno' }, admin)).json.id;
  });

  it('sem localização: avisa e não consulta o OSM', async () => {
    const antes = chamadasPredios;
    const r = await req('GET', `/projetos/${p}/entorno`, undefined, consultora);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ semLocalizacao: true, predios: [] });
    expect(chamadasPredios).toBe(antes);
  });

  it('primeira visita consulta o OSM uma vez; as seguintes usam o cache; traz a atribuição da licença', async () => {
    await req('PATCH', `/projetos/${p}`, { lat: -23.56175, lon: -46.6545 }, admin);
    const antes = chamadasPredios;
    const r1 = await req('GET', `/projetos/${p}/entorno`, undefined, consultora);
    expect(r1.status).toBe(200);
    expect(r1.json.semLocalizacao).toBe(false);
    expect(r1.json.centro).toEqual({ lat: -23.56175, lon: -46.6545 });
    expect(r1.json.predios).toHaveLength(1);
    expect(r1.json.predios[0].alturaM).toBe(60);
    expect(r1.json.atribuicao).toMatch(/OpenStreetMap/);
    const r2 = await req('GET', `/projetos/${p}/entorno`, undefined, consultora);
    expect(r2.json.predios).toEqual(r1.json.predios);
    expect(chamadasPredios).toBe(antes + 1);
  });

  it('mudar a localização menos de 50 m mantém o cache; mais que isso consulta de novo', async () => {
    const antes = chamadasPredios;
    await req('PATCH', `/projetos/${p}`, { lat: -23.5618, lon: -46.6545 }, admin); // ~6 m
    await req('GET', `/projetos/${p}/entorno`, undefined, admin);
    expect(chamadasPredios).toBe(antes);
    await req('PATCH', `/projetos/${p}`, { lat: -23.5630, lon: -46.6545 }, admin); // ~140 m
    const r = await req('GET', `/projetos/${p}/entorno`, undefined, admin);
    expect(chamadasPredios).toBe(antes + 1);
    expect(r.json.centro).toEqual({ lat: -23.563, lon: -46.6545 });
  });

  it('OSM fora do ar: com cache válido serve o cache; sem cache, 502', async () => {
    mapaFora = true;
    try {
      expect((await req('GET', `/projetos/${p}/entorno`, undefined, admin)).status).toBe(200);
      const outro = (await req('POST', '/projetos', { nome: 'Sem cache' }, admin)).json.id;
      await req('PATCH', `/projetos/${outro}`, { lat: -23.56, lon: -46.65 }, admin);
      const r = await req('GET', `/projetos/${outro}/entorno`, undefined, admin);
      expect(r.status).toBe(502);
      expect(r.json.erro).toBe('servico_mapa_indisponivel');
    } finally {
      mapaFora = false;
    }
  });

  it('forçar atualização: só a gestão; outra empresa não vê', async () => {
    expect((await req('POST', `/projetos/${p}/entorno/atualizar`, {}, consultora)).status).toBe(403);
    const antes = chamadasPredios;
    const r = await req('POST', `/projetos/${p}/entorno/atualizar`, {}, admin);
    expect(r.status).toBe(200);
    expect(r.json.predios).toBe(1);
    expect(chamadasPredios).toBe(antes + 1);
    expect((await req('GET', `/projetos/${p}/entorno`, undefined, outra)).status).toBe(404);
    expect((await req('POST', `/projetos/${p}/entorno/atualizar`, {}, outra)).status).toBe(404);
  });
});
