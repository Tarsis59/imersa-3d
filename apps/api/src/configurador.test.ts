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
const OWNER = process.env.TEST_API6_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_6';
const APP = process.env.TEST_API6_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_6';
const config: Config = {
  DATABASE_URL: APP,
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
  TOTP_KEY: randomBytes(32).toString('base64url'),
  PORT: 0,
  CORS_ORIGIN: 'http://localhost:3000',
  WEB_URL: 'http://localhost:3000',
  RATE_LIMIT_AUTH: 1000,
  TRUST_PROXY: true,
  AMBIENTE: 'teste',
  API_URL_PUBLICA: 'https://api.exemplo.com',
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
async function login(slug: string, email: string) {
  return (await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug })).json.acesso as string;
}
async function admin(slug: string, email: string): Promise<string> {
  await req('POST', '/auth/registro', { empresa: { nome: `Construtora ${slug}`, slug }, nome: 'Gestora', email, senha: SENHA });
  const l = await login(slug, email);
  const at = await req('POST', '/auth/mfa/ativar', {}, l);
  return (await req('POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l)).json.acesso;
}
async function membro(slug: string, email: string, papel: 'admin' | 'consultora' | 'produtor'): Promise<string> {
  const t = await owner.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [slug]);
  const u = await owner.query<{ id: string }>("INSERT INTO users (nome, email, senha_hash) VALUES ('Ana', $1, $2) RETURNING id", [email, await hashSenha(SENHA)]);
  await owner.query('INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, $3)', [t.rows[0]!.id, u.rows[0]!.id, papel]);
  return login(slug, email);
}
const PLANILHA = ['predio;andar;codigo;status', 'Casa;1;1;disponivel', 'Casa;1;2;disponivel', 'Outro;1;X1;disponivel'].join('\n');

let gestaoA = '';
let semMfaA = '';
let consultoraA = '';
let produtorA = '';
let gestaoB = '';
let projeto = '';
let casa = '';
let outro = '';
let u1 = '';
let uX = '';

beforeAll(async () => {
  await resetarBanco(OWNER);
  owner = new pg.Pool({ connectionString: OWNER });
  pool = new pg.Pool({ connectionString: APP });
  app = await construirApp({ pool, config });
  gestaoA = await admin('config-a', 'gestora@a.com');
  consultoraA = await membro('config-a', 'ana@a.com', 'consultora');
  produtorA = await membro('config-a', 'pedro@a.com', 'produtor');
  gestaoB = await admin('config-b', 'gestora@b.com');
  // outra pessoa da gestão, ainda sem a verificação em duas etapas
  semMfaA = await membro('config-a', 'chefe@a.com', 'admin');
  projeto = (await req('POST', '/projetos', { nome: 'Casa FZK' }, gestaoA)).json.id;
  expect((await req('POST', `/projetos/${projeto}/importacao`, { csv: PLANILHA, aplicar: true }, gestaoA)).status).toBe(200);
  const predios = (await req('GET', `/projetos/${projeto}`, undefined, gestaoA)).json.predios as Array<{ id: string; nome: string }>;
  casa = predios.find((p) => p.nome === 'Casa')!.id;
  outro = predios.find((p) => p.nome === 'Outro')!.id;
  const un = async (codigo: string) => (await owner.query<{ id: string }>('SELECT id FROM units WHERE codigo = $1', [codigo])).rows[0]!.id;
  u1 = await un('1');
  uX = await un('X1');
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await owner.end();
});

const MATERIAL = { nome: 'Porcelanato Areia 60×60', categoria: 'piso', padrao: 'porcelanato', cor: '#D8CFBF', rugosidade: 0.45, escalaM: 0.6, precoM2: 89.9, fornecedor: 'Cerâmica X' };

describe('catálogo de materiais', () => {
  let id = '';
  it('a gestão (com MFA) cadastra; cor normalizada; nome repetido = 409; consultora e sem MFA não editam', async () => {
    const r = await req('POST', '/materiais', MATERIAL, gestaoA);
    expect(r.status).toBe(201);
    id = r.json.id;
    expect((await req('POST', '/materiais', MATERIAL, gestaoA)).status).toBe(409);
    expect((await req('POST', '/materiais', { ...MATERIAL, nome: 'Outro' }, consultoraA)).status).toBe(403);
    expect((await req('POST', '/materiais', { ...MATERIAL, nome: 'Outro' }, semMfaA)).json.erro).toBe('mfa_requerido');
    expect((await req('POST', '/materiais', { ...MATERIAL, nome: 'Cor ruim', cor: 'azul' }, gestaoA)).status).toBe(400);
    expect((await req('POST', '/materiais', { ...MATERIAL, nome: 'Preço fracionado', precoM2: 10.001 }, gestaoA)).status).toBe(400);
    const lista = (await req('GET', '/materiais', undefined, consultoraA)).json;
    expect(lista).toEqual([expect.objectContaining({ id, cor: '#d8cfbf', precoM2: 89.9, escalaM: 0.6, padrao: 'porcelanato', ativo: true })]);
  });

  it('alterar preço e desativar; desativado some da lista, menos para a gestão com ?todos=1', async () => {
    expect((await req('PATCH', `/materiais/${id}`, { precoM2: 95 }, gestaoA)).json.precoM2).toBe(95);
    expect((await req('PATCH', `/materiais/${id}`, {}, gestaoA)).status).toBe(400);
    expect((await req('PATCH', `/materiais/${id}`, { ativo: false }, gestaoA)).json.ativo).toBe(false);
    expect((await req('GET', '/materiais', undefined, gestaoA)).json).toEqual([]);
    expect((await req('GET', '/materiais?todos=1', undefined, gestaoA)).json).toHaveLength(1);
    expect((await req('GET', '/materiais?todos=1', undefined, consultoraA)).json).toEqual([]);
    expect((await req('PATCH', `/materiais/${id}`, { ativo: true }, gestaoA)).status).toBe(200);
    // outra empresa não vê nem altera
    expect((await req('GET', '/materiais', undefined, gestaoB)).json).toEqual([]);
    expect((await req('PATCH', `/materiais/${id}`, { precoM2: 1 }, gestaoB)).status).toBe(404);
  });

  it('catálogo inicial: materiais sem preço e os móveis padrão com licença; rodar de novo não duplica', async () => {
    const r = await req('POST', '/materiais/catalogo-inicial', {}, gestaoA);
    expect(r.json.materiais).toBeGreaterThanOrEqual(15);
    expect(r.json.moveis).toBeGreaterThanOrEqual(12);
    expect((await req('POST', '/materiais/catalogo-inicial', {}, gestaoA)).json).toEqual({ materiais: 0, moveis: 0 });
    const mats = (await req('GET', '/materiais', undefined, gestaoA)).json as Array<{ nome: string; precoM2: number | null }>;
    expect(mats.filter((m) => m.precoM2 !== null).map((m) => m.nome)).toEqual([MATERIAL.nome]);
    const moveis = (await req('GET', '/moveis', undefined, consultoraA)).json as Array<{ modeloPadrao: string; licenca: string; autor: string }>;
    expect(moveis.every((m) => m.modeloPadrao && m.licenca === 'Própria (Imersa 3D)' && m.autor === 'Imersa 3D')).toBe(true);
    expect((await req('POST', '/materiais/catalogo-inicial', {}, consultoraA)).status).toBe(403);
  });
});

describe('catálogo de móveis', () => {
  it('GLB próprio entra só com licença e autor, e só se for modelo 3D verificado da empresa', async () => {
    const asset = async (tipo: string, status: string, nome: string) =>
      (
        await owner.query<{ id: string }>(
          'INSERT INTO assets (tenant_id, project_id, tipo, nome, chave, tamanho_declarado, status) SELECT tenant_id, id, $2, $3, $4, 1000, $5 FROM projects WHERE id = $1 RETURNING id',
          [projeto, tipo, nome, `t/${nome}`, status],
        )
      ).rows[0]!.id;
    const glb = await asset('modelo_3d', 'pronto', 'poltrona.glb');
    const pendente = await asset('modelo_3d', 'aguardando_envio', 'mesa.glb');
    const planta = await asset('planta', 'pronto', 'planta.pdf');
    const novo = { nome: 'Poltrona Charles', categoria: 'sala', arquivoId: glb, preco: 2499.9, licenca: 'Comprada do fornecedor', autor: 'Móveis Y', fonteUrl: 'https://moveisy.com.br/poltrona' };
    expect((await req('POST', '/moveis', { ...novo, licenca: '' }, gestaoA)).status).toBe(400);
    expect((await req('POST', '/moveis', { ...novo, fonteUrl: 'http://moveisy.com.br' }, gestaoA)).status).toBe(400);
    expect((await req('POST', '/moveis', { ...novo, arquivoId: pendente }, gestaoA)).json.erro).toBe('arquivo_invalido_para_movel');
    expect((await req('POST', '/moveis', { ...novo, arquivoId: planta }, gestaoA)).json.erro).toBe('arquivo_invalido_para_movel');
    expect((await req('POST', '/moveis', { ...novo, modeloPadrao: 'sofa-3' }, gestaoA)).status).toBe(400); // os dois
    expect((await req('POST', '/moveis', { nome: 'Disco voador', categoria: 'sala', modeloPadrao: 'disco', licenca: 'x1', autor: 'x1' }, gestaoA)).json.erro).toBe('modelo_padrao_inexistente');
    // outra empresa não usa o arquivo da A
    expect((await req('POST', '/moveis', { ...novo, nome: 'Roubada' }, gestaoB)).json.erro).toBe('arquivo_invalido_para_movel');
    expect((await req('POST', '/moveis', novo, gestaoA)).status).toBe(201);
    const lista = (await req('GET', '/moveis', undefined, gestaoA)).json as Array<{ nome: string; arquivoNome: string | null; preco: number | null }>;
    expect(lista.find((m) => m.nome === 'Poltrona Charles')).toMatchObject({ arquivoNome: 'poltrona.glb', preco: 2499.9, licenca: 'Comprada do fornecedor' });
  });
});

describe('combinações e orçamento', () => {
  let porcelanato = '';
  let pintura = '';
  let cadeira = '';
  let sofa = '';
  let config1 = '';
  beforeAll(async () => {
    const mats = (await req('GET', '/materiais', undefined, gestaoA)).json as Array<{ id: string; nome: string }>;
    porcelanato = mats.find((m) => m.nome === MATERIAL.nome)!.id; // R$ 95/m²
    pintura = mats.find((m) => m.nome === 'Pintura acrílica branco neve')!.id; // sem preço
    const moveis = (await req('GET', '/moveis', undefined, gestaoA)).json as Array<{ id: string; nome: string }>;
    cadeira = moveis.find((m) => m.nome === 'Cadeira')!.id;
    sofa = moveis.find((m) => m.nome === 'Sofá 3 lugares')!.id;
    expect((await req('PATCH', `/moveis/${cadeira}`, { preco: 350 }, gestaoA)).json.preco).toBe(350);
  });
  const pose = { x: 1, y: 0, z: 2, giroGraus: 90 };
  const corpo = () => ({
    nome: 'Família Souza · opção A',
    cliente: 'Família Souza',
    unidadeId: u1,
    superficies: [
      { chave: 'pisos', rotulo: 'Pisos e lajes', areaM2: 50.25, materialId: porcelanato },
      { chave: 'paredes', rotulo: 'Paredes', areaM2: 180, materialId: pintura },
      { chave: 'telhado', rotulo: 'Telhado', areaM2: 90, materialId: null },
    ],
    moveis: [
      { instanciaId: 'c1', movelId: cadeira, pose },
      { instanciaId: 'c2', movelId: cadeira, pose: { ...pose, x: 2 } },
      { instanciaId: 's1', movelId: sofa, pose },
    ],
  });

  it('a consultora salva; a API calcula o orçamento com os preços do catálogo (não confia no navegador)', async () => {
    const r = await req('POST', `/predios/${casa}/configuracoes`, { ...corpo(), total: 1 }, consultoraA);
    expect(r.status).toBe(201);
    config1 = r.json.id;
    // 50,25 × 95 = 4.773,75 + 2 cadeiras × 350 = 700 → 5.473,75; pintura e sofá sem preço
    expect(r.json.orcamento.total).toBe(5473.75);
    expect(r.json.orcamento.semPreco).toBe(2);
    expect(r.json.orcamento.linhas.map((l: { item: string; valor: number }) => [l.item, l.valor])).toEqual([
      [MATERIAL.nome, 4773.75],
      ['Pintura acrílica branco neve', 0],
      ['Cadeira', 700],
      ['Sofá 3 lugares', 0],
    ]);
    const lido = (await req('GET', `/configuracoes/${config1}`, undefined, consultoraA)).json;
    expect(lido).toMatchObject({ nome: 'Família Souza · opção A', cliente: 'Família Souza', unidadeCodigo: '1', total: 5473.75, predioNome: 'Casa', projetoNome: 'Casa FZK' });
    expect(lido.escolhas.moveis).toHaveLength(3);
  });

  it('recusa unidade de outro prédio, material de outra empresa, superfície e móvel repetidos, papel sem permissão', async () => {
    expect((await req('POST', `/predios/${casa}/configuracoes`, { ...corpo(), unidadeId: uX }, consultoraA)).json.erro).toBe('unidade_de_outro_predio');
    const deB = (await req('POST', '/materiais', { ...MATERIAL, nome: 'Da B' }, gestaoB)).json.id;
    const c = corpo();
    c.superficies[0]!.materialId = deB;
    expect((await req('POST', `/predios/${casa}/configuracoes`, c, consultoraA)).json.erro).toBe('material_inexistente');
    const rep = corpo();
    rep.superficies.push({ ...rep.superficies[0]! });
    expect((await req('POST', `/predios/${casa}/configuracoes`, rep, consultoraA)).json.erro).toBe('superficie_repetida');
    const repM = corpo();
    repM.moveis.push({ ...repM.moveis[0]! });
    expect((await req('POST', `/predios/${casa}/configuracoes`, repM, consultoraA)).json.erro).toBe('movel_repetido');
    expect((await req('POST', `/predios/${casa}/configuracoes`, corpo(), produtorA)).status).toBe(403);
    expect((await req('POST', `/predios/${casa}/configuracoes`, corpo(), gestaoB)).status).toBe(404);
    expect((await req('POST', `/predios/${outro}/configuracoes`, { ...corpo(), moveis: [{ instanciaId: 'x', movelId: sofa, pose: { ...pose, giroGraus: 400 } }] }, consultoraA)).status).toBe(400);
  });

  it('alterar recalcula com o preço novo; consultora só vê as dela; a gestão vê todas e apaga', async () => {
    await req('PATCH', `/materiais/${porcelanato}`, { precoM2: 100 }, gestaoA);
    const r = await req('PUT', `/configuracoes/${config1}`, { ...corpo(), moveis: [] }, consultoraA);
    expect(r.json.orcamento.total).toBe(5025); // 50,25 × 100
    const outra = await membro('config-a', 'bia@a.com', 'consultora');
    expect((await req('GET', `/predios/${casa}/configuracoes`, undefined, outra)).json).toEqual([]);
    expect((await req('GET', `/configuracoes/${config1}`, undefined, outra)).status).toBe(404);
    expect((await req('PUT', `/configuracoes/${config1}`, corpo(), outra)).status).toBe(404);
    const daGestao = (await req('GET', `/predios/${casa}/configuracoes`, undefined, gestaoA)).json;
    expect(daGestao).toEqual([expect.objectContaining({ id: config1, total: 5025, unidadeCodigo: '1', criadoPor: expect.objectContaining({ nome: 'Ana' }) })]);
    expect((await req('DELETE', `/configuracoes/${config1}`, undefined, gestaoA)).status).toBe(204);
    expect((await req('GET', `/configuracoes/${config1}`, undefined, gestaoA)).status).toBe(404);
    const audit = await owner.query("SELECT acao FROM audit_logs WHERE acao LIKE 'configuracao.%' ORDER BY criado_em");
    expect(audit.rows.map((x) => x.acao)).toEqual(['configuracao.criar', 'configuracao.alterar', 'configuracao.apagar']);
  });
});

describe('plantas: leitura → edição → modelo do prédio', () => {
  it('fila de leitura, worker grava a imagem e a detecção, edição validada, modelo ligado ao prédio', async () => {
    const { ArmazenamentoLocal } = await import('./arquivos/armazenamento');
    const { processarProximaPlanta } = await import('./plantas/worker');
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const pasta = await mkdtemp(join(tmpdir(), 'plantas-'));
    const armazenamento = new ArmazenamentoLocal(join(pasta, 'arq'), 'https://api.exemplo.com', config.JWT_SECRET);
    const asset = async (tipo: string, nome: string, status = 'pronto') =>
      (
        await owner.query<{ id: string; chave: string }>(
          'INSERT INTO assets (tenant_id, project_id, tipo, nome, chave, tamanho_declarado, status) SELECT tenant_id, id, $2, $3, $4, 10, $5 FROM projects WHERE id = $1 RETURNING id, chave',
          [projeto, tipo, nome, `t/${Date.now()}-${nome}`, status],
        )
      ).rows[0]!;
    const planta = await asset('planta', 'térreo.pdf');
    await armazenamento.salvar(planta.chave, Buffer.from('%PDF-1.4 teste'), 'application/pdf');
    const dwg = await asset('planta', 'térreo.dwg');
    expect((await req('POST', `/projetos/${projeto}/plantas`, { arquivoId: dwg.id }, gestaoA)).json.erro).toBe('dwg_salvar_como_dxf');
    expect((await req('POST', `/projetos/${projeto}/plantas`, { arquivoId: planta.id }, consultoraA)).status).toBe(403);
    const r = await req('POST', `/projetos/${projeto}/plantas`, { arquivoId: planta.id }, gestaoA);
    expect(r.status).toBe(201);
    expect((await req('POST', `/projetos/${projeto}/plantas`, { arquivoId: planta.id }, gestaoA)).json.erro).toBe('leitura_em_andamento');
    expect((await req('POST', `/projetos/${projeto}/plantas`, { arquivoId: planta.id }, gestaoB)).status).toBe(404);

    // worker com um leitor de mentira (o motor Python tem os próprios testes)
    const deteccao = { largura: 800, altura: 700, paredes: [{ x1: 100, y1: 100, x2: 700, y2: 100, espessura: 15 }], aberturas: [], comodos: [], escalaMPorPx: null };
    const leitor = async (entrada: string, p: string) => {
      expect(entrada.endsWith('.pdf')).toBe(true);
      const imagem = join(p, 'planta.png');
      await writeFile(imagem, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return { ok: true as const, imagem, deteccao };
    };
    expect(await processarProximaPlanta({ pool, armazenamento, leitor, pastaTrabalho: pasta })).toBe('ok');
    expect(await processarProximaPlanta({ pool, armazenamento, leitor, pastaTrabalho: pasta })).toBe('vazia');
    const lista = (await req('GET', `/projetos/${projeto}/plantas`, undefined, consultoraA)).json;
    expect(lista).toEqual([expect.objectContaining({ id: r.json.id, status: 'pronto', arquivoNome: 'térreo.pdf', paredes: 1, editada: false })]);
    const lida = (await req('GET', `/plantas/${r.json.id}`, undefined, gestaoA)).json;
    expect(lida.deteccao).toEqual(deteccao);
    expect(lida.imagemArquivoId).toBeTruthy();

    const edicao = { escalaMPorPx: 0.02, alturaParedeM: 2.8, alturaPortaM: 2.1, peitorilM: 1, alturaJanelaM: 1.2, paredes: deteccao.paredes, aberturas: [{ tipo: 'porta', x1: 300, y1: 100, x2: 345, y2: 100, espessura: 15 }] };
    expect((await req('PUT', `/plantas/${r.json.id}/edicao`, { ...edicao, alturaParedeM: 50 }, gestaoA)).status).toBe(400);
    expect((await req('PUT', `/plantas/${r.json.id}/edicao`, edicao, gestaoA)).json).toEqual({ ok: true });
    expect((await req('GET', `/projetos/${projeto}/plantas`, undefined, gestaoA)).json[0].editada).toBe(true);

    // 3D gerado no editor: só GLB verificado do mesmo empreendimento; liga ao prédio e desfaz vínculos antigos
    const glb = await asset('modelo_3d', 'planta.glb');
    const pendente = await asset('modelo_3d', 'x.glb', 'aguardando_envio');
    expect((await req('POST', `/plantas/${r.json.id}/modelo`, { arquivoId: pendente.id, predioId: casa }, gestaoA)).json.erro).toBe('arquivo_invalido_para_modelo');
    await owner.query("UPDATE units SET mesh_node_id = 'velho' WHERE id = $1", [u1]);
    expect((await req('POST', `/plantas/${r.json.id}/modelo`, { arquivoId: glb.id, predioId: casa }, gestaoA)).json).toEqual({ ok: true });
    expect((await owner.query('SELECT modelo_asset_id FROM buildings WHERE id = $1', [casa])).rows[0].modelo_asset_id).toBe(glb.id);
    expect((await owner.query('SELECT mesh_node_id FROM units WHERE id = $1', [u1])).rows[0].mesh_node_id).toBeNull();
  });

  it('planta recusada pelo leitor vira erro com a mensagem, sem nova tentativa', async () => {
    const { ArmazenamentoLocal } = await import('./arquivos/armazenamento');
    const { processarProximaPlanta } = await import('./plantas/worker');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const pasta = await mkdtemp(join(tmpdir(), 'plantas-'));
    const armazenamento = new ArmazenamentoLocal(join(pasta, 'arq'), 'https://api.exemplo.com', config.JWT_SECRET);
    const a = (
      await owner.query<{ id: string; chave: string }>(
        "INSERT INTO assets (tenant_id, project_id, tipo, nome, chave, tamanho_declarado, status) SELECT tenant_id, id, 'planta', 'ruim.png', 't/ruim.png', 10, 'pronto' FROM projects WHERE id = $1 RETURNING id, chave",
        [projeto],
      )
    ).rows[0]!;
    await armazenamento.salvar(a.chave, Buffer.from('x'), 'image/png');
    const id = (await req('POST', `/projetos/${projeto}/plantas`, { arquivoId: a.id }, gestaoA)).json.id;
    const leitor = async () => ({ ok: false as const, recusado: true, mensagem: 'imagem ilegível' });
    expect(await processarProximaPlanta({ pool, armazenamento, leitor, pastaTrabalho: pasta })).toBe('erro');
    expect((await req('GET', `/plantas/${id}`, undefined, gestaoA)).json).toMatchObject({ status: 'erro', mensagem: 'imagem ilegível' });
  });
});
