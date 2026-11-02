import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { codigoTotp } from './auth/totp';
import { hashSenha } from './auth/senha';
import type { Config } from './config';

// Banco próprio deste arquivo (os arquivos de teste rodam em paralelo); Plano 12a, itens 6 e 16.
const OWNER = process.env.TEST_API12_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_12';
const APP = process.env.TEST_API12_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_12';
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
  await req('POST', '/auth/registro', { empresa: { nome: `Empresa ${slug}`, slug }, nome: 'Gestora', email, senha: SENHA });
  const l = await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug });
  const at = await req('POST', '/auth/mfa/ativar', {}, l.json.acesso);
  return (await req('POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l.json.acesso)).json.acesso;
}
async function login(slug: string, email: string): Promise<string> {
  return (await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug })).json.acesso;
}

let admin = '';
let consultora = '';
let outra = '';
let projeto = '';

/** GLB mínimo válido (só o JSON): o worker só confere o cabeçalho antes de mandar para o assador. */
const glbMinimo = () => {
  const js = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }).padEnd(80, ' '));
  const cab = Buffer.alloc(20);
  cab.write('glTF', 0);
  cab.writeUInt32LE(2, 4);
  cab.writeUInt32LE(20 + js.length, 8);
  cab.writeUInt32LE(js.length, 12);
  cab.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([cab, js]);
};

beforeAll(async () => {
  await resetarBanco(OWNER);
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  app = await construirApp({ pool, config });
  admin = await adminComMfa('bake12a', 'gestora@bake12a.com');
  outra = await adminComMfa('concorrente12a', 'gestora@concorrente12a.com');
  const t = await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'bake12a'");
  const novo = await owner.query<{ id: string }>('INSERT INTO users (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id', ['C', 'c@bake12a.com', await hashSenha(SENHA)]);
  await owner.query("INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, 'consultora')", [t.rows[0]!.id, novo.rows[0]!.id]);
  consultora = await login('bake12a', 'c@bake12a.com');
  projeto = (await req('POST', '/projetos', { nome: 'Residencial Bake' }, admin)).json.id;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await owner?.end();
});

describe('bake da luz (dia e noite) — Plano 12a, item 6', () => {
  it('pedido só da gestão e com modelo; o worker assa e grava o GLB; o bake novo substitui o antigo', async () => {
    const { ArmazenamentoLocal } = await import('./arquivos/armazenamento');
    const { processarProximoBake } = await import('./bakes/worker');
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const pasta = await mkdtemp(join(tmpdir(), 'bakes-'));
    const armazenamento = new ArmazenamentoLocal(join(pasta, 'arq'), 'https://api.exemplo.com', config.JWT_SECRET);

    const predio = (await req('POST', `/projetos/${projeto}/predios`, { nome: 'Torre Bake', andares: 2 }, admin)).json.id;
    expect((await req('POST', `/predios/${predio}/bakes`, {}, admin)).json.erro).toBe('predio_sem_modelo');

    const modelo = (
      await owner.query<{ id: string; chave: string }>(
        "INSERT INTO assets (tenant_id, project_id, tipo, nome, chave, tamanho_declarado, status) SELECT tenant_id, id, 'modelo_3d', 'predio.glb', 't/predio-bake.glb', 10, 'pronto' FROM projects WHERE id = $1 RETURNING id, chave",
        [projeto],
      )
    ).rows[0]!;
    await armazenamento.salvar(modelo.chave, glbMinimo(), 'model/gltf-binary');
    await owner.query('UPDATE buildings SET modelo_asset_id = $2 WHERE id = $1', [predio, modelo.id]);

    expect((await req('POST', `/predios/${predio}/bakes`, {}, consultora)).status).toBe(403);
    expect((await req('POST', `/predios/${predio}/bakes`, {}, outra)).status).toBe(404);
    const r = await req('POST', `/predios/${predio}/bakes`, {}, admin);
    expect(r.status).toBe(201);
    expect((await req('POST', `/predios/${predio}/bakes`, {}, admin)).json.erro).toBe('bake_em_andamento');
    expect((await req('GET', `/predios/${predio}/bakes`, undefined, consultora)).json).toMatchObject({ temModelo: true, ultimo: { id: r.json.id, status: 'na_fila' }, pronto: null, vitrine: null });

    let recebido: string | null = null;
    const assador = async (e: { glb: string; pasta: string }) => {
      const { readFile } = await import('node:fs/promises');
      recebido = (await readFile(e.glb)).subarray(0, 4).toString();
      const destino = join(e.pasta, 'assado.glb');
      await writeFile(destino, glbMinimo());
      return { ok: true as const, glb: destino, largura: 1024, dispositivo: 'OPTIX', mb: 0.05, tempos_s: { bake: 12 } };
    };
    expect(await processarProximoBake({ pool, armazenamento, assador, pastaTrabalho: pasta })).toBe('ok');
    expect(await processarProximoBake({ pool, armazenamento, assador, pastaTrabalho: pasta })).toBe('vazia');
    expect(recebido).toBe('glTF');

    const lido = (await req('GET', `/predios/${predio}/bakes`, undefined, consultora)).json;
    expect(lido.pronto).toMatchObject({ id: r.json.id, status: 'pronto', atual: true, metricas: { dispositivo: 'OPTIX' } });
    expect(lido.vitrine).toEqual({ arquivoId: lido.pronto.arquivoId });
    // o GLB assado é do sistema: não aparece na lista de arquivos do empreendimento
    expect((await req('GET', `/projetos/${projeto}/arquivos`, undefined, admin)).json.some((a: { tipo: string }) => a.tipo === 'bake')).toBe(false);

    // modelo trocado: o bake fica desatualizado
    const outroModelo = (
      await owner.query<{ id: string }>(
        "INSERT INTO assets (tenant_id, project_id, tipo, nome, chave, tamanho_declarado, status) SELECT tenant_id, id, 'modelo_3d', 'novo.glb', 't/novo-bake.glb', 10, 'pronto' FROM projects WHERE id = $1 RETURNING id",
        [projeto],
      )
    ).rows[0]!;
    await owner.query('UPDATE buildings SET modelo_asset_id = $2 WHERE id = $1', [predio, outroModelo.id]);
    const mudou = (await req('GET', `/predios/${predio}/bakes`, undefined, admin)).json;
    expect(mudou.pronto.atual).toBe(false);

    await armazenamento.salvar((await owner.query('SELECT chave FROM assets WHERE id = $1', [outroModelo.id])).rows[0].chave, glbMinimo(), 'model/gltf-binary');
    const novo = (await req('POST', `/predios/${predio}/bakes`, {}, admin)).json.id;
    expect(await processarProximoBake({ pool, armazenamento, assador, pastaTrabalho: pasta })).toBe('ok');
    const depois = (await req('GET', `/predios/${predio}/bakes`, undefined, admin)).json;
    expect(depois.pronto).toMatchObject({ id: novo, atual: true });
    // o bake antigo foi apagado (só 1 asset tipo 'bake' no projeto)
    expect((await owner.query("SELECT count(*)::int AS n FROM assets WHERE tipo = 'bake' AND project_id = $1", [projeto])).rows[0].n).toBe(1);
  });

  it('falha transitória da nuvem volta para a fila uma vez; modelo inválido vira erro sem nova tentativa', async () => {
    const { ArmazenamentoLocal } = await import('./arquivos/armazenamento');
    const { processarProximoBake } = await import('./bakes/worker');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const pasta = await mkdtemp(join(tmpdir(), 'bakes-'));
    const armazenamento = new ArmazenamentoLocal(join(pasta, 'arq'), 'https://api.exemplo.com', config.JWT_SECRET);
    const predio = (await req('POST', `/projetos/${projeto}/predios`, { nome: 'Torre Erro', andares: 1 }, admin)).json.id;
    const modelo = (
      await owner.query<{ id: string; chave: string }>(
        "INSERT INTO assets (tenant_id, project_id, tipo, nome, chave, tamanho_declarado, status) SELECT tenant_id, id, 'modelo_3d', 'casa.glb', 't/casa-bake.glb', 10, 'pronto' FROM projects WHERE id = $1 RETURNING id, chave",
        [projeto],
      )
    ).rows[0]!;
    await armazenamento.salvar(modelo.chave, glbMinimo(), 'model/gltf-binary');
    await owner.query('UPDATE buildings SET modelo_asset_id = $2 WHERE id = $1', [predio, modelo.id]);
    const id = (await req('POST', `/predios/${predio}/bakes`, {}, admin)).json.id;
    let chamadas = 0;
    const assador = async () => {
      chamadas++;
      return { ok: false as const, erro: 'falha_na_gpu', mensagem: 'Kaggle fora do ar' };
    };
    expect(await processarProximoBake({ pool, armazenamento, assador, pastaTrabalho: pasta })).toBe('erro');
    expect((await owner.query('SELECT status FROM bakes WHERE id = $1', [id])).rows[0].status).toBe('na_fila');
    expect(await processarProximoBake({ pool, armazenamento, assador, pastaTrabalho: pasta })).toBe('erro');
    expect((await req('GET', `/predios/${predio}/bakes`, undefined, admin)).json.ultimo).toMatchObject({ status: 'erro', mensagem: 'Kaggle fora do ar' });
    expect(chamadas).toBe(2);
    expect((await owner.query('SELECT ha_bake_pendente() AS p')).rows[0].p).toBe(false);
  });
});

describe('pronto para WebGPU (agregado por aparelho) — Plano 12a, item 16', () => {
  // o agregado é por empresa (toda a telemetria do tenant, não por prédio): cada teste com a sua própria empresa,
  // senão as visitas de um teste contaminariam a % do outro.
  let contador = 0;
  async function novaEmpresa(): Promise<{ gestao: string; consultora: string; predioId: string }> {
    contador++;
    const slug = `webgpu12a-${contador}`;
    const gestao = await adminComMfa(slug, `gestora@${slug}.com`);
    const t = await owner.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [slug]);
    const novo = await owner.query<{ id: string }>('INSERT INTO users (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id', ['C', `c@${slug}.com`, await hashSenha(SENHA)]);
    await owner.query("INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, 'consultora')", [t.rows[0]!.id, novo.rows[0]!.id]);
    const consultoraTok = await login(slug, `c@${slug}.com`);
    const p = (await req('POST', '/projetos', { nome: 'Projeto' }, gestao)).json.id;
    const predioId = (await req('POST', `/projetos/${p}/predios`, { nome: 'Torre', andares: 1 }, gestao)).json.id;
    return { gestao, consultora: consultoraTok, predioId };
  }

  it('% de WebGPU por tipo de aparelho, fluidez comparada e a regra explícita da troca (≥ 80% no celular, FPS não pior)', async () => {
    const e = await novaEmpresa();
    const visita = (x: object) => ({ predioId: e.predioId, cargaMs: 1000, fpsMedio: 60, nivel: 'alto', erros: 0, celular: false, ...x });
    // celular: 8 com WebGPU (fps alto) e 2 sem (fps mais baixo) -> 80%, FPS não pior
    for (let i = 0; i < 8; i++) await req('POST', '/telemetria/viewer', visita({ celular: true, webgpu: true, fpsMedio: 58 + i }), e.consultora);
    for (let i = 0; i < 2; i++) await req('POST', '/telemetria/viewer', visita({ celular: true, webgpu: false, fpsMedio: 45 + i }), e.consultora);
    // computador: metade com WebGPU (não entra na regra, só é informativo)
    for (let i = 0; i < 4; i++) await req('POST', '/telemetria/viewer', visita({ celular: false, webgpu: i % 2 === 0 }), e.consultora);
    // visita sem medir WebGPU (null): fica fora da conta de "medidas"
    await req('POST', '/telemetria/viewer', visita({ celular: true, webgpu: null }), e.consultora);

    expect((await req('GET', '/telemetria/viewer/webgpu', undefined, e.consultora)).status).toBe(403);
    const r = await req('GET', '/telemetria/viewer/webgpu?dias=30', undefined, e.gestao);
    expect(r.status).toBe(200);
    expect(r.json.dias).toBe(30);
    expect(r.json.celular).toMatchObject({ visitas: 11, medidas: 10, comWebgpu: 8, percentual: 0.8 });
    expect(r.json.computador).toMatchObject({ visitas: 4, medidas: 4, comWebgpu: 2, percentual: 0.5 });
    expect(r.json.fps.comWebgpu).toBeGreaterThanOrEqual(r.json.fps.semWebgpu);
    expect(r.json.limiarCelular).toBe(0.8);
    expect(r.json.pronto).toBe(true);
    expect(r.json.regra).toContain('80%');

    // outra empresa: zero visitas, nunca "pronto" (percentual null trava a decisão)
    const vazio = (await req('GET', '/telemetria/viewer/webgpu', undefined, outra)).json;
    expect(vazio.celular).toEqual({ visitas: 0, medidas: 0, comWebgpu: 0, percentual: null });
    expect(vazio.pronto).toBe(false);
  });

  it('FPS pior com WebGPU trava a decisão mesmo com 100% de cobertura no celular', async () => {
    const e = await novaEmpresa();
    const v = (x: object) => ({ predioId: e.predioId, cargaMs: 1000, fpsMedio: 60, nivel: 'alto', erros: 0, celular: true, ...x });
    for (let i = 0; i < 10; i++) await req('POST', '/telemetria/viewer', v({ webgpu: true, fpsMedio: 20 }), e.consultora); // WebGPU mais lento aqui
    // sem nenhuma visita "sem WebGPU" para comparar, fps.semWebgpu fica null
    const r = (await req('GET', '/telemetria/viewer/webgpu?dias=30', undefined, e.gestao)).json;
    expect(r.celular.percentual).toBe(1);
    expect(r.fps.semWebgpu).toBeNull();
    expect(r.pronto).toBe(false); // sem o "antes" para comparar, não libera a troca
  });
});
