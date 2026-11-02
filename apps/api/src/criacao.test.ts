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
import type { ServicosMapa } from './mapa/osm';
import type { Config } from './config';
import { montagensRodando } from './criacao/montagem';

// Banco próprio deste arquivo (os arquivos de teste rodam em paralelo).
const OWNER = process.env.TEST_API8_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_8';
const APP = process.env.TEST_API8_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_8';
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

const consultas: string[] = [];
let mapaFora = false;
const CURITIBA = { lat: -25.4411, lon: -49.2908 };
const mapaFalso: ServicosMapa = {
  buscarEndereco: async (q) => {
    consultas.push(q);
    if (mapaFora) throw new Error('fora do ar');
    if (/flores/i.test(q)) return [{ rotulo: 'Rua das Flores, 120, Batel, Curitiba', ...CURITIBA }];
    if (/sete de setembro/i.test(q)) return [{ rotulo: 'Avenida Sete de Setembro, Curitiba', lat: -25.44, lon: -49.28 }];
    if (/^lisboa/i.test(q)) return [{ rotulo: 'Lisboa, Portugal', lat: 38.72, lon: -9.14 }];
    return [];
  },
  buscarPois: async () => {
    if (mapaFora) throw new Error('fora do ar');
    return [
      { osmId: 'node/1', categoria: 'escola', nome: 'Escola Estadual', lat: -25.4405, lon: -49.2901 },
      { osmId: 'node/2', categoria: 'mercado', nome: 'Mercado do Bairro', lat: -25.4420, lon: -49.2915 },
    ];
  },
  buscarPredios: async () => {
    if (mapaFora) throw new Error('fora do ar');
    return [{ osmId: 'way/7', alturaM: 24, contorno: [[-49.2911, -25.4415], [-49.2909, -25.4415], [-49.2909, -25.4413]] }];
  },
  buscarCep: async (cep) => (cep === '80420000' ? { logradouro: 'Avenida Sete de Setembro', bairro: 'Batel', localidade: 'Curitiba', uf: 'PR' } : null),
};

let app: FastifyInstance;
let pool: pg.Pool;
let owner: pg.Pool;
let pasta: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resp = { status: number; json: any };
async function req(method: 'GET' | 'POST', url: string, body?: object, token?: string): Promise<Resp> {
  const r = await app.inject({ method, url, payload: body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': '203.0.113.9' } });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : undefined };
}

async function adminComMfa(slug: string, email: string): Promise<string> {
  await req('POST', '/auth/registro', { empresa: { nome: `Construtora ${slug}`, slug }, nome: 'Gestora', email, senha: SENHA });
  const l = await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug });
  const at = await req('POST', '/auth/mfa/ativar', {}, l.json.acesso);
  return (await req('POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l.json.acesso)).json.acesso;
}

let gestao = '';
let consultora = '';
let concorrente = '';

beforeAll(async () => {
  await resetarBanco(OWNER);
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  pasta = await mkdtemp(join(tmpdir(), 'imersa-criacao-'));
  app = await construirApp({ pool, config, armazenamento: new ArmazenamentoLocal(pasta, 'http://api.teste', SEGREDO), mapa: mapaFalso });
  gestao = await adminComMfa('construtora', 'gestora@c.com');
  concorrente = await adminComMfa('concorrente', 'gestora@x.com');
  const t = await owner.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'construtora'");
  const u = await owner.query<{ id: string }>('INSERT INTO users (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING id', ['Ana', 'ana@c.com', await hashSenha(SENHA)]);
  await owner.query("INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, 'consultora')", [t.rows[0]!.id, u.rows[0]!.id]);
  consultora = (await req('POST', '/auth/login', { email: 'ana@c.com', senha: SENHA, empresa: 'construtora' })).json.acesso;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await owner?.end();
  await rm(pasta, { recursive: true, force: true });
});

const TEXTO = 'Residencial Aurora, com 12 andares, 4 apartamentos por andar, 2 e 3 quartos de 62 e 85 m², piscina e academia, na Rua das Flores, 120, Batel, Curitiba/PR.';

async function criar(corpo: Record<string, unknown>, token = gestao) {
  const texto = (corpo.texto as string | undefined) ?? '';
  const descricao = corpo.descricao ?? (await req('POST', '/criacao/interpretar', { texto }, token)).json.descricao;
  return req('POST', '/criacao', { nome: 'Residencial Aurora', ...corpo, texto, descricao }, token);
}
async function montar(montagemId: string, corpo: object = {}, token = gestao) {
  const r = await req('POST', `/montagens/${montagemId}/iniciar`, corpo, token);
  expect(r.status).toBe(202);
  await montagensRodando.get(montagemId);
  return (await req('GET', `/montagens/${montagemId}`, undefined, token)).json;
}
const etapa = (m: { etapas: Array<{ id: string; estado: string; detalhe: string }> }, id: string) => m.etapas.find((e) => e.id === id)!;

describe('criação integrada (Plano 11a)', () => {
  it('interpretar mostra o que vai sair, sem gravar nada', async () => {
    const r = await req('POST', '/criacao/interpretar', { texto: TEXTO }, gestao);
    expect(r.status).toBe(200);
    expect(r.json.descricao).toMatchObject({ nome: 'Residencial Aurora', andares: 12, unidadesPorAndar: 4, cidade: 'Curitiba', uf: 'PR' });
    expect(r.json.plano).toMatchObject({ unidades: 48, andares: 12, porAndar: 4, predios: ['Torre A'] });
    expect(r.json.plano.tipologias.map((t: { nome: string; unidades: number }) => [t.nome, t.unidades])).toEqual([
      ['2 quartos', 24],
      ['3 quartos', 24],
    ]);
    expect((await owner.query('SELECT count(*)::int AS n FROM projects')).rows[0].n).toBe(0);
  });

  it('só quem cria projeto (gestão com MFA) usa a criação', async () => {
    expect((await req('POST', '/criacao/interpretar', { texto: TEXTO }, consultora)).status).toBe(403);
    expect((await criar({ texto: TEXTO }, consultora)).status).toBe(403);
  });

  it('texto → empreendimento pronto: lugar, 48 unidades, lazer no 3D, cidade e pontos próximos', async () => {
    const c = await criar({ texto: TEXTO });
    expect(c.status).toBe(201);
    const m = await montar(c.json.montagemId);
    expect(m.estado).toBe('pronta');
    expect(m.etapas.map((e: { estado: string }) => e.estado)).toEqual(['feita', 'feita', 'feita', 'feita', 'feita', 'feita', 'pulada']);
    expect(etapa(m, 'local').detalhe).toBe('Achado pelo endereço do texto.');
    expect(etapa(m, 'predio').detalhe).toBe('48 unidades em 12 andares (1 prédio, 2 tipologias), pelo texto.');
    expect(m.predioId).toBeTruthy();

    const p = (await owner.query('SELECT nome, endereco, cidade, uf, ST_Y(geom) AS lat, ST_X(geom) AS lon FROM projects WHERE id = $1', [c.json.projetoId])).rows[0];
    expect(p).toMatchObject({ nome: 'Residencial Aurora', endereco: 'Rua das Flores, 120, Batel', cidade: 'Curitiba', uf: 'PR', lat: CURITIBA.lat, lon: CURITIBA.lon });
    const u = (await owner.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE t.quartos = 3)::int AS tres, count(*) FILTER (WHERE u.preco IS NULL)::int AS sem_preco FROM units u JOIN unit_types t ON t.id = u.unit_type_id")).rows[0];
    expect(u).toEqual({ n: 48, tres: 24, sem_preco: 48 });
    const lazer = (await owner.query('SELECT categoria, nome, x_m, y_m, z_m, ordem FROM lazer WHERE building_id = $1 ORDER BY ordem', [m.predioId])).rows;
    expect(lazer.map((l) => l.categoria)).toEqual(['piscina', 'academia']);
    for (const l of lazer) expect(Math.max(Math.abs(l.x_m), Math.abs(l.z_m))).toBeGreaterThan(8);
    expect((await owner.query('SELECT jsonb_array_length(predios) AS n FROM entornos WHERE project_id = $1', [c.json.projetoId])).rows[0].n).toBe(1);
    expect((await owner.query('SELECT count(*)::int AS n FROM pois WHERE project_id = $1', [c.json.projetoId])).rows[0].n).toBe(2);
    // o portal público já serve o lazer (tour pronto sem marcar à mão)
    const acoes = (await owner.query("SELECT acao FROM audit_logs WHERE acao LIKE 'montagem.%' OR acao = 'projeto.localizar' ORDER BY id")).rows.map((r) => r.acao);
    expect(acoes).toEqual(['montagem.iniciar', 'projeto.localizar', 'montagem.predio']);
  });

  it('o mesmo endereço não vai ao Nominatim duas vezes (cache)', async () => {
    const antes = consultas.length;
    const c = await criar({ texto: TEXTO });
    await montar(c.json.montagemId);
    expect(consultas.length).toBe(antes);
  });

  it('sem andares e sem planilha não cria nada', async () => {
    const r = await criar({ texto: 'Prédio com piscina na Rua das Flores' });
    expect(r.status).toBe(400);
    expect(r.json.erro).toBe('sem_andares');
  });

  it('planilha manda nas unidades; o texto dá o lazer e o lugar', async () => {
    const planilha = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Bloco 1;1;11;Tipo A;70;2;500.000,00;disponivel', 'Bloco 1;2;21;Tipo A;70;2;520.000,00;reservado'].join('\n');
    const c = await criar({ texto: 'Churrasqueira e playground. Rua das Flores, 120, Curitiba/PR.', planilha });
    expect(c.status).toBe(201);
    const m = await montar(c.json.montagemId);
    expect(etapa(m, 'predio').detalhe).toBe('2 unidades em 2 andares (1 prédio, 1 tipologias), da planilha.');
    expect((await owner.query('SELECT codigo, preco::float8 AS preco, status FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.project_id = $1 ORDER BY codigo', [c.json.projetoId])).rows).toEqual([
      { codigo: '11', preco: 500000, status: 'disponivel' },
      { codigo: '21', preco: 520000, status: 'reservado' },
    ]);
    expect((await owner.query('SELECT count(*)::int AS n FROM lazer WHERE building_id = $1', [m.predioId])).rows[0].n).toBe(2);
    expect((await criar({ texto: 'x', planilha: 'predio;andar\nA;x' })).json.erro).toBe('planilha_invalida');
  });

  it('sem endereço: acha pelo GPS das fotos (a foto de outro lugar fica de fora)', async () => {
    const gps = [CURITIBA, { lat: CURITIBA.lat + 0.0002, lon: CURITIBA.lon }, { lat: CURITIBA.lat - 0.0001, lon: CURITIBA.lon + 0.0001 }, { lat: -23.56, lon: -46.65 }];
    const c = await criar({ texto: '8 andares, 2 por andar, 3 quartos', pistas: { gps } });
    const m = await montar(c.json.montagemId);
    expect(etapa(m, 'local')).toMatchObject({ estado: 'feita', detalhe: 'Achado pelo GPS das fotos.' });
    const p = (await owner.query('SELECT ST_Y(geom) AS lat FROM projects WHERE id = $1', [c.json.projetoId])).rows[0];
    expect(Math.abs(p.lat - CURITIBA.lat)).toBeLessThan(0.0003);
  });

  it('sem nada para achar o lugar: avisa e retoma com o CEP', async () => {
    const c = await criar({ texto: '5 andares, 4 por andar, 2 quartos' });
    const m = await montar(c.json.montagemId);
    expect(m.estado).toBe('pronta_com_avisos');
    expect(etapa(m, 'local').estado).toBe('aviso');
    expect(etapa(m, 'cidade').estado).toBe('pulada');
    // retomar não duplica unidades e acha o lugar pelo CEP
    const m2 = await montar(c.json.montagemId, { cep: '80420-000' });
    expect(m2.estado).toBe('pronta');
    expect(etapa(m2, 'local').detalhe).toBe('Achado pelo CEP.');
    expect(etapa(m2, 'predio')).toMatchObject({ estado: 'pulada', detalhe: 'O empreendimento já tinha 20 unidades.' });
    expect(etapa(m2, 'cidade').estado).toBe('feita');
  });

  it('só a cidade: lugar aproximado vira aviso; resultado fora do Brasil é recusado', async () => {
    const c = await criar({ texto: '5 andares, 4 por andar, 2 quartos, em Lisboa' });
    const m = await montar(c.json.montagemId);
    expect(etapa(m, 'local').estado).toBe('aviso');
    expect((await owner.query('SELECT geom FROM projects WHERE id = $1', [c.json.projetoId])).rows[0].geom).toBeNull();
  });

  it('mapa fora do ar: a montagem termina com avisos, sem perder o prédio', async () => {
    mapaFora = true;
    try {
      const c = await criar({ texto: '5 andares, 4 por andar, 2 quartos', pistas: { local: { ...CURITIBA, rotulo: 'Escolhido' } } });
      const m = await montar(c.json.montagemId);
      expect(m.estado).toBe('pronta_com_avisos');
      expect(etapa(m, 'predio').estado).toBe('feita');
      expect(etapa(m, 'cidade').estado).toBe('aviso');
      expect(etapa(m, 'pontos').estado).toBe('aviso');
    } finally {
      mapaFora = false;
    }
  });

  it('arquivos vão para o caminho certo: IFC → BIM, planta → leitura, vídeo → captura; recusado não entra', async () => {
    const c = await criar({ texto: '3 andares, 2 por andar, 2 quartos', pistas: { local: { ...CURITIBA, rotulo: 'Escolhido' } } });
    const t = (await owner.query<{ tenant_id: string }>('SELECT tenant_id FROM projects WHERE id = $1', [c.json.projetoId])).rows[0]!.tenant_id;
    const arquivo = async (tipo: string, nome: string, status = 'pronto') =>
      (
        await owner.query<{ id: string }>("INSERT INTO assets (tenant_id, project_id, tipo, nome, chave, tamanho_declarado, status) VALUES ($1, $2, $3, $4, 'x/' || gen_random_uuid(), 100, $5) RETURNING id", [
          t,
          c.json.projetoId,
          tipo,
          nome,
          status,
        ])
      ).rows[0]!.id;
    const arquivos = [
      { id: await arquivo('ifc', 'predio.ifc'), papel: 'ifc' },
      { id: await arquivo('planta', 'tipo.pdf'), papel: 'planta' },
      { id: await arquivo('captura', 'passeio.mp4'), papel: 'captura' },
      { id: await arquivo('imagem', 'fachada.jpg'), papel: 'fachada' },
      { id: await arquivo('imagem', 'meio.jpg', 'aguardando_envio'), papel: 'foto' },
    ];
    const m = await montar(c.json.montagemId, { arquivos });
    expect(etapa(m, 'arquivos')).toMatchObject({
      estado: 'aviso',
      detalhe: '1 projeto BIM na fila de conversão; 1 planta na fila de leitura; 1 captura na fila do 3D real (GPU); 1 guardado nos arquivos do empreendimento; 1 não pôde ser usado (envio incompleto ou recusado).',
    });
    expect((await owner.query('SELECT count(*)::int AS n FROM conversoes_bim WHERE project_id = $1', [c.json.projetoId])).rows[0].n).toBe(1);
    expect((await owner.query('SELECT count(*)::int AS n FROM plantas WHERE project_id = $1', [c.json.projetoId])).rows[0].n).toBe(1);
    expect((await owner.query("SELECT count(*)::int AS n FROM capturas WHERE project_id = $1 AND status = 'na_fila'", [c.json.projetoId])).rows[0].n).toBe(1);
    // retomar não põe o mesmo arquivo duas vezes na fila
    await montar(c.json.montagemId);
    expect((await owner.query('SELECT count(*)::int AS n FROM conversoes_bim WHERE project_id = $1', [c.json.projetoId])).rows[0].n).toBe(1);
  });

  it('outra empresa não vê nem inicia a montagem; duas vezes ao mesmo tempo não roda', async () => {
    const c = await criar({ texto: '3 andares, 2 por andar, 2 quartos' });
    expect((await req('GET', `/montagens/${c.json.montagemId}`, undefined, concorrente)).status).toBe(404);
    expect((await req('POST', `/montagens/${c.json.montagemId}/iniciar`, {}, concorrente)).status).toBe(404);
    const a = req('POST', `/montagens/${c.json.montagemId}/iniciar`, {}, gestao);
    const b = req('POST', `/montagens/${c.json.montagemId}/iniciar`, {}, gestao);
    const st = [(await a).status, (await b).status].sort();
    expect(st).toEqual([202, 409]);
    await montagensRodando.get(c.json.montagemId);
    expect((await req('GET', `/projetos/${c.json.projetoId}/montagem`, undefined, gestao)).json.estado).toBe('pronta_com_avisos');
  });
});

describe('editar e pedir por texto (Plano 11e, itens 22 e 23)', () => {
  it('mostra o que muda sem gravar; só grava confirmado, em transação, com auditoria do texto', async () => {
    const c = await criar({ texto: '3 andares, 2 por andar, 2 quartos', pistas: { local: { ...CURITIBA, rotulo: 'Escolhido' } } });
    const m = await montar(c.json.montagemId);
    const predio = m.predioId as string;
    const texto = 'a 101 foi vendida, a 102 custa 650 mil e o 2º andar agora tem 4 unidades. Vídeo de 15 s para o Instagram com voz masculina';
    const previa = await req('POST', `/predios/${predio}/comandos`, { texto }, gestao);
    expect(previa.status).toBe(200);
    expect(previa.json.mudancas).toEqual([
      '101: disponível → vendida',
      'Preço da 102: sem preço → R$ 650.000,00',
      '2º andar: 2 → 4 unidades (novas: 203, 204, disponíveis, sem preço)',
      'Pedir vídeo vertical (Instagram, Reels, Stories) com voz masculina e legenda',
    ]);
    expect(previa.json.avisos).toEqual(['O vídeo tem a duração do passeio de câmera do estúdio: os 15 s pedidos não mudam o tamanho.']);
    // nada gravado na prévia
    const antes = (await owner.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'vendido')::int AS v FROM units WHERE building_id = $1", [predio])).rows[0];
    expect(antes).toEqual({ n: 6, v: 0 });

    const feito = await req('POST', `/predios/${predio}/comandos`, { texto, aplicar: true }, gestao);
    expect(feito.json).toMatchObject({ aplicado: true, acoes: [{ tipo: 'video', formato: '9:16', voz: 'pm_alex' }] });
    const depois = (await owner.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'vendido')::int AS v, max(preco) FILTER (WHERE codigo = '102')::float8 AS p FROM units WHERE building_id = $1", [predio])).rows[0];
    expect(depois).toEqual({ n: 8, v: 1, p: 650000 });
    const audit = (await owner.query("SELECT depois FROM audit_logs WHERE acao = 'comando.aplicar' AND entidade_id = $1", [predio])).rows;
    expect(audit[0].depois.texto).toBe(texto);
    expect((await owner.query("SELECT motivo FROM unit_status_history h JOIN units u ON u.id = h.unit_id WHERE u.building_id = $1 AND u.codigo = '101'", [predio])).rows[0].motivo).toMatch(/^Pedido por texto/);
  });

  it('o que não pode vira aviso (transição proibida, unidade que não existe, tirar unidades); outra empresa não acessa', async () => {
    const c = await criar({ texto: '2 andares, 2 por andar, 2 quartos' });
    const predio = (await montar(c.json.montagemId)).predioId as string;
    await req('POST', `/predios/${predio}/comandos`, { texto: 'a 101 foi vendida', aplicar: true }, gestao);
    const r = await req('POST', `/predios/${predio}/comandos`, { texto: 'reserva a 101, a 999 foi vendida e o 1º andar agora tem 1 unidades', aplicar: true }, gestao);
    expect(r.json.mudancas).toEqual([]);
    expect(r.json.avisos).toEqual([
      'A 101 não pode passar de vendida para reservada.',
      'Não há unidade 999 neste prédio.',
      'O 1º andar tem 2 unidades: para tirar unidades, use a tela de unidades (nada some por texto).',
    ]);
    expect((await req('POST', `/predios/${predio}/comandos`, { texto: 'a 102 foi vendida' }, concorrente)).status).toBe(404);
    expect((await req('POST', `/predios/${predio}/comandos`, { texto: 'a 102 foi vendida' }, consultora)).status).toBe(403);
  });
});

describe('medida do fluxo (Plano 11f)', () => {
  it('resumo das montagens: total, prontas, avisos, falhas, tempo e etapas', async () => {
    const r = await req('GET', '/montagens/resumo', undefined, gestao);
    expect(r.status).toBe(200);
    expect(r.json.total).toBeGreaterThan(5);
    expect(r.json.prontas + r.json.comAvisos + r.json.falhas).toBeLessThanOrEqual(r.json.total);
    expect(r.json.medianaMs).toBeGreaterThanOrEqual(0);
    expect(r.json.etapas.predio.feitas).toBeGreaterThan(0);
    expect(Object.keys(r.json.etapas).sort()).toEqual(['arquivos', 'cidade', 'lazer', 'local', 'pontos', 'predio', 'texto']);
    expect((await req('GET', '/montagens/resumo', undefined, consultora)).status).toBe(403);
  });
});

