import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { processarProxima, type Reconstrutor } from './capturas/worker';
import { processarProximaConversao, type ConversorBim } from './bim/worker';
import type { ServicosMapa } from './mapa/osm';
import type { Config } from './config';
import { esperarComplementos } from './rotas/mapa';

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
  RATE_LIMIT_GERAL: 300,
  TRUST_PROXY: false,
  AMBIENTE: 'teste',
  WEBHOOK_PERMITIR_LOCAL: false,
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
  async buscarMalha(lat, lon) {
    chamadasMalha++;
    if (malhaFora) throw new Error('Overpass respondeu 429');
    // uma rua do prédio até a estação Trianon-MASP (a rota a pé desenhada passa por ela)
    return { vias: [{ osmId: 'way/9', tipo: 'local', nome: 'Rua de teste', larguraM: 7, pontos: [[lon, lat], [-46.6555, -23.5616], [-46.6564, -23.5614]] }], areas: [] };
  },
};
let chamadasPredios = 0;
let chamadasMalha = 0;
let malhaFora = false;

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

  it('ruas que não vieram (mapa cheio) não ficam "sem ruas" para sempre: tenta de novo depois de 10 min', async () => {
    const q = (await req('POST', '/projetos', { nome: 'Ruas depois' }, admin)).json.id;
    await req('PATCH', `/projetos/${q}`, { lat: -23.57, lon: -46.64 }, admin);
    malhaFora = true;
    try {
      const r1 = await req('GET', `/projetos/${q}/entorno`, undefined, admin);
      expect(r1.status).toBe(200);
      expect(r1.json.vias).toEqual([]);
      // guardado como "não sei ainda", não como "não há ruas"
      expect((await owner.query('SELECT vias FROM entornos WHERE project_id = $1', [q])).rows[0].vias).toBeNull();
      // logo em seguida não insiste (cada visita não espera o mapa de novo)
      const antes = chamadasMalha;
      await req('GET', `/projetos/${q}/entorno`, undefined, admin);
      expect(chamadasMalha).toBe(antes);
    } finally {
      malhaFora = false;
    }
    // passados 10 min, a próxima visita busca de novo por trás (sem esperar o mapa) e as ruas ficam guardadas
    await owner.query("UPDATE entornos SET atualizado_em = now() - interval '11 minutes' WHERE project_id = $1", [q]);
    const antes = chamadasMalha;
    const [r2, r3] = await Promise.all([req('GET', `/projetos/${q}/entorno`, undefined, admin), req('GET', `/projetos/${q}/entorno`, undefined, admin)]);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    await esperarComplementos();
    // duas visitas juntas pedem as ruas uma vez só
    expect(chamadasMalha).toBe(antes + 1);
    expect((await owner.query('SELECT jsonb_array_length(vias) AS n FROM entornos WHERE project_id = $1', [q])).rows[0].n).toBe(1);
    expect((await req('GET', `/projetos/${q}/entorno`, undefined, admin)).json.vias).toHaveLength(1);
  });

  it('visitas juntas sem cache esperam a mesma consulta dos prédios', async () => {
    const q = (await req('POST', '/projetos', { nome: 'Visitas juntas' }, admin)).json.id;
    await req('PATCH', `/projetos/${q}`, { lat: -23.58, lon: -46.63 }, admin);
    const antes = chamadasPredios;
    const rs = await Promise.all([1, 2, 3].map(() => req('GET', `/projetos/${q}/entorno`, undefined, admin)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(chamadasPredios).toBe(antes + 1);
  });

  it('rota a pé desenhada até o ponto: painel e link do cliente; ponto de outro projeto = 404', async () => {
    const q = (await req('POST', '/projetos', { nome: 'Rota a pé' }, admin)).json.id;
    await req('PATCH', `/projetos/${q}`, { lat: -23.56175, lon: -46.6545 }, admin);
    expect((await req('GET', `/projetos/${q}/entorno`, undefined, admin)).json.vias).toHaveLength(1);
    expect((await req('POST', `/projetos/${q}/pois/osm`, {}, admin)).status).toBeLessThan(300);
    const pois = (await req('GET', `/projetos/${q}/pois`, undefined, consultora)).json.pois as Array<{ id: string; nome: string }>;
    const metro = pois.find((x) => x.nome === 'Estação Trianon-MASP')!;
    const r = await req('GET', `/projetos/${q}/pois/${metro.id}/rota`, undefined, consultora);
    expect(r.status).toBe(200);
    expect(r.json.rota.pontos.length).toBeGreaterThanOrEqual(3);
    expect(r.json.rota.pontos[0]).toEqual([-46.6545, -23.56175]);
    expect(r.json.rota.pontos.at(-1)).toEqual([-46.6564, -23.5614]);
    expect(r.json.rota.metros).toBeGreaterThan(150);
    expect(r.json.rota.minutosAPe).toBeGreaterThanOrEqual(2);
    // ponto de outro projeto (ou inventado) não vaza
    expect((await req('GET', `/projetos/${p}/pois/${metro.id}/rota`, undefined, admin)).status).toBe(404);
    expect((await req('GET', `/projetos/${q}/pois/${metro.id}/rota`, undefined, outra)).status).toBe(404);
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

describe('telemetria do viewer', () => {
  let predio = '';
  beforeAll(async () => {
    const p = (await req('POST', '/projetos', { nome: 'Projeto telemetria' }, admin)).json.id;
    predio = (await req('POST', `/projetos/${p}/predios`, { nome: 'Torre T', andares: 2 }, admin)).json.id;
  });
  const sessao = (x: object) => ({ predioId: predio, cargaMs: 1500, fpsMedio: 60, nivel: 'alto', erros: 0, celular: false, ...x });

  it('qualquer papel registra uma visita (204); valores absurdos são recusados (400)', async () => {
    expect((await req('POST', '/telemetria/viewer', sessao({}), consultora)).status).toBe(204);
    expect((await req('POST', '/telemetria/viewer', sessao({ fpsMedio: 9999 }), consultora)).status).toBe(400);
    expect((await req('POST', '/telemetria/viewer', sessao({ nivel: 'ultra' }), consultora)).status).toBe(400);
    expect((await req('POST', '/telemetria/viewer', sessao({ cargaMs: -1 }), consultora)).status).toBe(400);
    expect((await req('POST', '/telemetria/viewer', sessao({}))).status).toBe(401);
  });

  it('prédio de outra empresa: 404 (não grava)', async () => {
    expect((await req('POST', '/telemetria/viewer', sessao({}), outra)).status).toBe(404);
  });

  it('resumo: p50/p95 de carga, p50 e 5% piores de FPS, erros e celular; só gestão', async () => {
    const cargas = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 9000];
    for (const [i, cargaMs] of cargas.entries()) {
      await req('POST', '/telemetria/viewer', sessao({ cargaMs, fpsMedio: 30 + i * 3, erros: i === 9 ? 2 : 0, celular: i % 2 === 0, nivel: i < 8 ? 'alto' : 'baixo', ...(i < 6 ? { webgpu: i < 3 } : {}) }), consultora);
    }
    expect((await req('GET', '/telemetria/viewer/resumo', undefined, consultora)).status).toBe(403);
    const r = await req('GET', '/telemetria/viewer/resumo?dias=7', undefined, admin);
    expect(r.status).toBe(200);
    expect(r.json.sessoes).toBe(11); // 10 + a do primeiro teste
    expect(r.json.cargaMs.p50).toBe(1800);
    expect(r.json.cargaMs.p95).toBeGreaterThan(2600);
    expect(r.json.fps.p50).toBe(45);
    expect(r.json.fps.p05).toBeLessThan(33);
    expect(r.json.taxaErro).toBeCloseTo(1 / 11, 3);
    expect(r.json.porNivel).toEqual({ alto: 9, medio: 0, baixo: 2 });
    expect(r.json.celular.sessoes).toBe(5);
    expect(r.json.webgpu).toEqual({ visitas: 3, medidas: 6 }); // quem não mediu (null) fica de fora da conta
    expect((await req('GET', '/telemetria/viewer/resumo', undefined, outra)).json.sessoes).toBe(0);
  });
});

describe('capturas: fotos/vídeo → 3D (fila, worker, revisão e publicação)', () => {
  const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]);
  const SOG = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('splat comprimido')]);
  let p = '';
  let pastaWorker = '';
  beforeAll(async () => {
    p = (await req('POST', '/projetos', { nome: 'Apartamento capturado' }, admin)).json.id;
    pastaWorker = await mkdtemp(join(tmpdir(), 'imersa-worker-'));
  });
  afterAll(() => rm(pastaWorker, { recursive: true, force: true }));

  async function novaCaptura(token: string, nome = 'Sala 101') {
    const d = await req('POST', `/projetos/${p}/arquivos`, { nome: 'fotos.zip', tipo: 'captura', tamanho: ZIP.length }, token);
    expect(d.status).toBe(201);
    expect((await enviar(d.json.envio.url, ZIP)).json.status).toBe('pronto');
    // o site sempre avisa a API que o envio terminou (no S3 é isso que dispara a verificação): a consultora também pode
    expect((await req('POST', `/arquivos/${d.json.id}/concluir`, {}, token)).json.status).toBe('pronto');
    const c = await req('POST', `/projetos/${p}/capturas`, { nome, arquivoId: d.json.id }, token);
    expect(c.status).toBe(201);
    return c.json.id as string;
  }
  const chamadas: Array<{ arquivo: string; tipo: string }> = [];
  const sucesso: Reconstrutor = async (e) => {
    chamadas.push({ arquivo: e.arquivo, tipo: e.tipo });
    const splat = join(e.pasta, 'cena.sog');
    await writeFile(splat, SOG);
    return { ok: true, splat, avisos: ['10% das fotos estão tremidas; elas serão ignoradas.'], metricas: { psnr: 27.5, gaussianas: 812345 }, rostos_desfocados: 2 };
  };
  const falha =
    (erro: string, mensagem: string, detalhes: string[] = []): Reconstrutor =>
    async () => ({ ok: false, erro, mensagem, detalhes });
  const deps = (reconstrutor: Reconstrutor) => ({ pool, armazenamento: new ArmazenamentoLocal(pasta, 'http://api.teste', SEGREDO), reconstrutor, pastaTrabalho: pastaWorker });
  const captura = async (id: string, token = admin) => (await req('GET', `/capturas/${id}`, undefined, token)).json;

  it('consultora envia; o worker processa e deixa em revisão; a gestão vê a prévia e publica como interior do projeto', async () => {
    const id = await novaCaptura(consultora);
    expect(await captura(id)).toMatchObject({ status: 'na_fila', nome: 'Sala 101', origem: 'fotos' });
    expect(await processarProxima(deps(sucesso))).toBe('ok');
    expect(chamadas.at(-1)!.tipo).toBe('zip');
    const c = await captura(id);
    expect(c).toMatchObject({ status: 'revisao', tentativas: 1, mensagem: null, metricas: { psnr: 27.5, gaussianas: 812345, rostosDesfocados: 2 } });
    expect(c.avisos).toEqual(['10% das fotos estão tremidas; elas serão ignoradas.']);
    // ainda não é arquivo do projeto (a Vitrine não mostra antes da revisão)
    expect((await req('GET', `/projetos/${p}/arquivos`, undefined, admin)).json.filter((a: { tipo: string }) => a.tipo === 'splat')).toHaveLength(0);
    // prévia para a revisão
    const previa = await req('GET', `/capturas/${id}/previa`, undefined, admin);
    expect(previa.status).toBe(200);
    const u = new URL(previa.json.url);
    expect((await app.inject({ method: 'GET', url: `${u.pathname}${u.search}` })).rawPayload.equals(SOG)).toBe(true);
    // consultora não publica; gestão publica
    expect((await req('POST', `/capturas/${id}/publicar`, {}, consultora)).status).toBe(403);
    const pub = await req('POST', `/capturas/${id}/publicar`, {}, admin);
    expect(pub.status).toBe(200);
    expect(await captura(id)).toMatchObject({ status: 'publicado', splatArquivoId: pub.json.arquivoId });
    const splats = (await req('GET', `/projetos/${p}/arquivos`, undefined, consultora)).json.filter((a: { tipo: string }) => a.tipo === 'splat');
    expect(splats).toEqual([expect.objectContaining({ id: pub.json.arquivoId, nome: 'Sala 101.sog', status: 'pronto', tamanho: SOG.length })]);
    expect((await req('POST', `/capturas/${id}/publicar`, {}, admin)).json.erro).toBe('captura_nao_esta_em_revisao');
  });

  it('resultado em SPZ (servidor sem GPU para o SOG): o arquivo publicado mantém a extensão real', async () => {
    const id = await novaCaptura(admin, 'Cozinha');
    const spz: Reconstrutor = async (e) => {
      const splat = join(e.pasta, 'cena.spz');
      await writeFile(splat, Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3]));
      return { ok: true, splat, avisos: [], metricas: {}, rostos_desfocados: 0 };
    };
    expect(await processarProxima(deps(spz))).toBe('ok');
    const pub = await req('POST', `/capturas/${id}/publicar`, {}, admin);
    const arquivos = (await req('GET', `/projetos/${p}/arquivos`, undefined, admin)).json;
    expect(arquivos.find((a: { id: string }) => a.id === pub.json.arquivoId)).toMatchObject({ nome: 'Cozinha.spz', tipo: 'splat' });
  });

  it('fila vazia: nada a fazer', async () => {
    expect(await processarProxima(deps(sucesso))).toBe('vazia');
  });

  it('fotos ruins: erro com a mensagem e os problemas, sem nova tentativa', async () => {
    const id = await novaCaptura(admin, 'Quarto escuro');
    const ruins = falha('fotos_reprovadas', 'As fotos não passaram na verificação de qualidade.', ['70% das fotos estão escuras demais']);
    expect(await processarProxima(deps(ruins))).toBe('erro');
    expect(await captura(id)).toMatchObject({ status: 'erro', mensagem: 'As fotos não passaram na verificação de qualidade.', detalhes: ['70% das fotos estão escuras demais'] });
    expect(await processarProxima(deps(sucesso))).toBe('vazia');
  });

  it('falha da GPU: volta para a fila uma vez; na 2ª falha vira erro; reenviar recomeça', async () => {
    const id = await novaCaptura(admin, 'Cozinha');
    const gpu = falha('falha_na_gpu', 'O processamento na nuvem falhou.');
    expect(await processarProxima(deps(gpu))).toBe('erro');
    expect(await captura(id)).toMatchObject({ status: 'na_fila', tentativas: 1 });
    expect(await processarProxima(deps(gpu))).toBe('erro');
    expect(await captura(id)).toMatchObject({ status: 'erro', tentativas: 2, mensagem: 'O processamento na nuvem falhou.' });
    expect((await req('POST', `/capturas/${id}/reenviar`, {}, admin)).status).toBe(200);
    expect(await captura(id)).toMatchObject({ status: 'na_fila', tentativas: 0, mensagem: null });
    expect((await req('POST', `/capturas/${id}/cancelar`, {}, admin)).status).toBe(200);
  });

  it('cancelada durante o processamento: o worker não sobrescreve', async () => {
    const id = await novaCaptura(admin, 'Varanda');
    const cancelaNoMeio: Reconstrutor = async (e) => {
      expect((await req('POST', `/capturas/${id}/cancelar`, {}, admin)).status).toBe(200);
      return sucesso(e);
    };
    await processarProxima(deps(cancelaNoMeio));
    expect(await captura(id)).toMatchObject({ status: 'cancelado' });
  });

  it('validação: arquivo que não é de captura ou ainda não enviado; outra empresa não vê', async () => {
    const pdf = await req('POST', `/projetos/${p}/arquivos`, { nome: 'planta.pdf', tipo: 'documento', tamanho: 10 }, admin);
    expect((await req('POST', `/projetos/${p}/capturas`, { nome: 'X', arquivoId: pdf.json.id }, admin)).json.erro).toBe('arquivo_invalido_para_captura');
    const pendente = await req('POST', `/projetos/${p}/arquivos`, { nome: 'f.zip', tipo: 'captura', tamanho: 100 }, admin);
    expect((await req('POST', `/projetos/${p}/capturas`, { nome: 'X', arquivoId: pendente.json.id }, admin)).json.erro).toBe('arquivo_invalido_para_captura');
    const lista = await req('GET', `/projetos/${p}/capturas`, undefined, consultora);
    expect(lista.status).toBe(200);
    expect(lista.json.length).toBeGreaterThanOrEqual(4);
    expect((await req('GET', `/projetos/${p}/capturas`, undefined, outra)).status).toBe(404);
    expect((await req('GET', `/capturas/${lista.json[0].id}`, undefined, outra)).status).toBe(404);
  });
});

describe('BIM: IFC → 3D, ambientes e vínculo com as unidades', () => {
  const IFC = Buffer.from(['ISO-10303-21;', 'HEADER;', 'ENDSEC;', 'DATA;', 'ENDSEC;', 'END-ISO-10303-21;', ''].join(String.fromCharCode(10)));
  const GLB_BIM = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(40, 2)]);
  const G101 = '2eyxpyOx95m90jmsXLOuR1';
  const G102 = '273g3wqLzDtfYIl7qqkgc2';
  const META = {
    schema: 'IFC4',
    andares: [{ guid: '2eyxpyOx95m90jmsXLOuR0', nome: 'Térreo', elevacao_m: 0 }],
    espacos: [
      { guid: G101, nome: '101', nome_longo: 'Apto 101', andar_guid: '2eyxpyOx95m90jmsXLOuR0', area_m2: 72.5 },
      { guid: G102, nome: 'Loja', nome_longo: null, andar_guid: '2eyxpyOx95m90jmsXLOuR0', area_m2: 40 },
    ],
    portas: 3,
    janelas: 6,
  };
  let p = '';
  let predio = '';
  let pastaWorker = '';
  let falhar: string | null = null;
  const conversor: ConversorBim = async (_ifc, pasta) => {
    if (falhar) return { ok: false, erro: falhar, mensagem: 'O arquivo não é um IFC válido.' };
    const glb = join(pasta, 'modelo.glb');
    await writeFile(glb, GLB_BIM);
    return { ok: true, glb, metadados: META, elementos: 12, bytesOriginal: 1000, bytes: GLB_BIM.length };
  };
  const deps = () => ({ pool, armazenamento: new ArmazenamentoLocal(pasta, 'http://api.teste', SEGREDO), conversor, pastaTrabalho: pastaWorker });

  beforeAll(async () => {
    p = (await req('POST', '/projetos', { nome: 'Residencial BIM' }, admin)).json.id;
    expect((await req('POST', `/projetos/${p}/importacao`, { csv: ['predio;andar;codigo', 'Torre;1;101', 'Torre;1;102'].join(String.fromCharCode(10)), aplicar: true }, admin)).status).toBe(200);
    predio = (await req('GET', `/projetos/${p}`, undefined, admin)).json.predios[0].id;
    pastaWorker = await mkdtemp(join(tmpdir(), 'imersa-bim-'));
  });
  afterAll(() => rm(pastaWorker, { recursive: true, force: true }));

  async function enviarIfc(): Promise<string> {
    const d = await req('POST', `/projetos/${p}/arquivos`, { nome: 'projeto.ifc', tipo: 'ifc', tamanho: IFC.length }, admin);
    expect(d.status).toBe(201);
    expect((await enviar(d.json.envio.url, IFC)).json.status).toBe('pronto');
    return d.json.id;
  }

  it('converte, guarda o 3D otimizado e os ambientes; sugere e grava os vínculos; liga o modelo ao prédio', async () => {
    const ifc = await enviarIfc();
    expect((await req('POST', `/projetos/${p}/conversoes`, { arquivoId: ifc }, consultora)).status).toBe(403);
    const c = await req('POST', `/projetos/${p}/conversoes`, { arquivoId: ifc }, admin);
    expect(c.status).toBe(201);
    expect((await req('POST', `/projetos/${p}/conversoes`, { arquivoId: ifc }, admin)).json.erro).toBe('conversao_em_andamento');
    expect((await req('GET', `/predios/${predio}/vinculos-bim?conversaoId=${c.json.id}`, undefined, admin)).json.erro).toBe('conversao_nao_pronta');

    expect(await processarProximaConversao(deps())).toBe('ok');
    expect(await processarProximaConversao(deps())).toBe('vazia');
    const lista = (await req('GET', `/projetos/${p}/conversoes`, undefined, consultora)).json;
    expect(lista[0]).toMatchObject({ id: c.json.id, status: 'pronto', arquivoNome: 'projeto.ifc', andares: 1, ambientes: 2 });
    const modelo = (await req('GET', `/projetos/${p}/arquivos`, undefined, admin)).json.find((a: { id: string }) => a.id === lista[0].glbArquivoId);
    expect(modelo).toMatchObject({ nome: 'projeto.glb', tipo: 'modelo_3d', status: 'pronto' });

    const tela = (await req('GET', `/predios/${predio}/vinculos-bim?conversaoId=${c.json.id}`, undefined, admin)).json;
    expect(tela.espacos).toEqual(expect.arrayContaining([expect.objectContaining({ guid: G101, nomeLongo: 'Apto 101', andar: 'Térreo', areaM2: 72.5 })]));
    const u101 = tela.unidades.find((u: { codigo: string }) => u.codigo === '101').id;
    const u102 = tela.unidades.find((u: { codigo: string }) => u.codigo === '102').id;
    expect(tela.sugestoes).toEqual([{ unidadeId: u101, espacoGuid: G101, motivo: 'codigo' }]);

    // ajuste manual: a 102 fica com a "Loja"
    const ruim = await req('POST', `/predios/${predio}/vinculos-bim`, { conversaoId: c.json.id, vinculos: [{ unidadeId: u101, espacoGuid: G101 }, { unidadeId: u102, espacoGuid: G101 }] }, admin);
    expect(ruim.json.erro).toBe('ambiente_repetido');
    const inexistente = await req('POST', `/predios/${predio}/vinculos-bim`, { conversaoId: c.json.id, vinculos: [{ unidadeId: u101, espacoGuid: 'X'.repeat(22) }] }, admin);
    expect(inexistente.json.erro).toBe('ambiente_inexistente');
    const ok = await req('POST', `/predios/${predio}/vinculos-bim`, { conversaoId: c.json.id, vinculos: [{ unidadeId: u101, espacoGuid: G101 }, { unidadeId: u102, espacoGuid: G102 }] }, admin);
    expect(ok.json).toEqual({ vinculadas: 2, modeloArquivoId: lista[0].glbArquivoId });
    const espelho = (await req('GET', `/predios/${predio}`, undefined, admin)).json;
    expect(espelho.predio.modeloArquivoId).toBe(lista[0].glbArquivoId);
    expect(espelho.andares[0].unidades.map((u: { meshNodeId: string }) => u.meshNodeId).sort()).toEqual([G101, G102].sort());
    expect((await req('GET', `/predios/${predio}/vinculos-bim?conversaoId=${c.json.id}`, undefined, outra)).status).toBe(404);
  });

  it('IFC recusado vira erro sem nova tentativa; arquivo que não é IFC não entra na fila', async () => {
    const ifc = await enviarIfc();
    const c = (await req('POST', `/projetos/${p}/conversoes`, { arquivoId: ifc }, admin)).json;
    falhar = 'ifc_invalido';
    try {
      expect(await processarProximaConversao(deps())).toBe('erro');
    } finally {
      falhar = null;
    }
    const lista = (await req('GET', `/projetos/${p}/conversoes`, undefined, admin)).json;
    expect(lista.find((x: { id: string }) => x.id === c.id)).toMatchObject({ status: 'erro', mensagem: 'O arquivo não é um IFC válido.' });
    const glb = (await req('GET', `/projetos/${p}/arquivos`, undefined, admin)).json.find((a: { tipo: string }) => a.tipo === 'modelo_3d');
    expect((await req('POST', `/projetos/${p}/conversoes`, { arquivoId: glb.id }, admin)).json.erro).toBe('arquivo_invalido_para_bim');
  });
});
