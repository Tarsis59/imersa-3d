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
const OWNER = process.env.TEST_API2_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_2';
const APP = process.env.TEST_API2_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_2';
const config: Config = {
  DATABASE_URL: APP,
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
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

let app: FastifyInstance;
let pool: pg.Pool;
let owner: pg.Pool;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resp = { status: number; json: any };
async function req(method: 'GET' | 'POST' | 'PATCH', url: string, body?: object, token?: string): Promise<Resp> {
  const r = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : undefined };
}

/** Registra empresa + admin e devolve um token de admin já com MFA. */
async function adminComMfa(slug: string, email: string): Promise<string> {
  await req('POST', '/auth/registro', { empresa: { nome: `Empresa ${slug}`, slug }, nome: 'Admin', email, senha: SENHA });
  const l = await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug });
  const at = await req('POST', '/auth/mfa/ativar', {}, l.json.acesso);
  return (await req('POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l.json.acesso)).json.acesso;
}

async function membro(slug: string, email: string, papel: string): Promise<string> {
  const t = await owner.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [slug]);
  const u = await owner.query<{ id: string }>("INSERT INTO users (nome, email, senha_hash) VALUES ('Pessoa', $1, $2) RETURNING id", [email, await hashSenha(SENHA)]);
  await owner.query('INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, $3)', [t.rows[0]!.id, u.rows[0]!.id, papel]);
  return (await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug })).json.acesso;
}

const CAB = 'predio;andar;codigo;tipologia;area_m2;quartos;suites;vagas;preco;status';
const PLANILHA = [
  CAB,
  'Torre A;1;101;Tipo 2Q;72,5;2;1;1;650.000,00;disponivel',
  'Torre A;1;102;Tipo 3Q;98;3;1;2;890.000,00;disponivel',
  'Torre A;2;201;Tipo 2Q;72,5;2;1;1;660.000,00;reservado',
  'Torre A;2;202;Tipo 3Q;98;3;1;2;900.000,00;vendido',
  'Torre B;0;T01;;;;;;;bloqueado',
].join('\n');

let admin = '';
let consultora = '';
let viewer = '';
let outraEmpresa = '';
let projeto = '';

beforeAll(async () => {
  await resetarBanco(OWNER);
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  app = await construirApp({ pool, config });
  admin = await adminComMfa('construtora', 'admin@c.com');
  consultora = await membro('construtora', 'consultora@c.com', 'consultora');
  viewer = await membro('construtora', 'viewer@c.com', 'viewer');
  outraEmpresa = await adminComMfa('concorrente', 'admin@x.com');
  projeto = (await req('POST', '/projetos', { nome: 'Residencial Paulista' }, admin)).json.id;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await owner.end();
});

describe('empreendimento', () => {
  it('edita dados e localização; devolve lat/lon', async () => {
    const r = await req(
      'PATCH',
      `/projetos/${projeto}`,
      { descricao: 'Torres na Paulista', endereco: 'Av. Paulista, 1000', cidade: 'São Paulo', uf: 'SP', lat: -23.56175, lon: -46.6545, status: 'lancamento' },
      admin,
    );
    expect(r.status).toBe(200);
    const d = await req('GET', `/projetos/${projeto}`, undefined, admin);
    expect(d.json.projeto).toMatchObject({ nome: 'Residencial Paulista', cidade: 'São Paulo', uf: 'SP', lat: -23.56175, lon: -46.6545, status: 'lancamento' });
  });

  it('recusa lat sem lon, UF inválida e status desconhecido', async () => {
    expect((await req('PATCH', `/projetos/${projeto}`, { lat: -23.5 }, admin)).status).toBe(400);
    expect((await req('PATCH', `/projetos/${projeto}`, { uf: 'sao' }, admin)).status).toBe(400);
    expect((await req('PATCH', `/projetos/${projeto}`, { status: 'demolido' }, admin)).status).toBe(400);
  });

  it('consultora lê mas não edita; outra empresa recebe 404', async () => {
    expect((await req('GET', `/projetos/${projeto}`, undefined, consultora)).status).toBe(200);
    expect((await req('PATCH', `/projetos/${projeto}`, { cidade: 'X' }, consultora)).status).toBe(403);
    expect((await req('GET', `/projetos/${projeto}`, undefined, outraEmpresa)).status).toBe(404);
    expect((await req('PATCH', `/projetos/${projeto}`, { cidade: 'X' }, outraEmpresa)).status).toBe(404);
  });

  it('id malformado → 400', async () => {
    expect((await req('GET', '/projetos/nao-e-uuid', undefined, admin)).status).toBe(400);
  });
});

describe('importação de planilha', () => {
  it('prévia mostra o que vai acontecer e NÃO grava nada', async () => {
    const r = await req('POST', `/projetos/${projeto}/importacao`, { csv: PLANILHA, aplicar: false }, admin);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ aplicado: false, erros: [] });
    expect(r.json.resumo).toEqual({ prediosNovos: 2, andaresNovos: 3, tipologiasNovas: 2, unidadesNovas: 5, unidadesAlteradas: 0, statusAlterados: 0, semMudanca: 0 });
    expect((await req('GET', `/projetos/${projeto}`, undefined, admin)).json.predios).toEqual([]);
  });

  it('erro em qualquer linha: nada é gravado e a resposta aponta linha e campo', async () => {
    const r = await req('POST', `/projetos/${projeto}/importacao`, { csv: `${PLANILHA}\nTorre A;x;999;;;;;;;`, aplicar: true }, admin);
    expect(r.status).toBe(400);
    expect(r.json.erros).toEqual([{ linha: 7, campo: 'andar', mensagem: 'deve ser número inteiro' }]);
    expect((await req('GET', `/projetos/${projeto}`, undefined, admin)).json.predios).toEqual([]);
  });

  it('aplica: cria prédios, andares, tipologias e unidades', async () => {
    const r = await req('POST', `/projetos/${projeto}/importacao`, { csv: PLANILHA, aplicar: true }, admin);
    expect(r.status).toBe(200);
    expect(r.json.aplicado).toBe(true);
    const d = (await req('GET', `/projetos/${projeto}`, undefined, admin)).json;
    expect(d.predios.map((p: { nome: string; unidades: number }) => [p.nome, p.unidades])).toEqual([
      ['Torre A', 4],
      ['Torre B', 1],
    ]);
    expect(d.tipologias.map((t: { nome: string; areaM2: number }) => [t.nome, t.areaM2])).toEqual([
      ['Tipo 2Q', 72.5],
      ['Tipo 3Q', 98],
    ]);
    expect(d.resumo).toEqual({ disponivel: 2, reservado: 1, vendido: 1, bloqueado: 1, total: 5 });
  });

  it('reimportar o mesmo arquivo não muda nada (idempotente)', async () => {
    const r = await req('POST', `/projetos/${projeto}/importacao`, { csv: PLANILHA, aplicar: true }, admin);
    expect(r.json.resumo).toEqual({ prediosNovos: 0, andaresNovos: 0, tipologiasNovas: 0, unidadesNovas: 0, unidadesAlteradas: 0, statusAlterados: 0, semMudanca: 5 });
  });

  it('atualiza preço e status seguindo as regras; transição proibida vira erro de linha', async () => {
    const ok = await req('POST', `/projetos/${projeto}/importacao`, { csv: `${CAB}\nTorre A;1;101;Tipo 2Q;72,5;2;1;1;655.000,00;reservado`, aplicar: true }, admin);
    expect(ok.json.resumo).toMatchObject({ unidadesAlteradas: 1, statusAlterados: 1 });
    const proibida = await req('POST', `/projetos/${projeto}/importacao`, { csv: `${CAB}\nTorre A;2;202;;;;;;;reservado`, aplicar: true }, admin);
    expect(proibida.status).toBe(400);
    expect(proibida.json.erros).toEqual([{ linha: 2, campo: 'status', mensagem: 'mudança de vendido para reservado não é permitida' }]);
  });

  it('tipologia existente com área diferente é recusada', async () => {
    const r = await req('POST', `/projetos/${projeto}/importacao`, { csv: `${CAB}\nTorre A;3;301;Tipo 2Q;80;2;1;1;;`, aplicar: false }, admin);
    expect(r.json.erros).toEqual([{ linha: 2, campo: 'tipologia', mensagem: 'tipologia "Tipo 2Q" já existe com outros valores; ajuste na tela de tipologias' }]);
  });

  it('só gestão com MFA importa', async () => {
    expect((await req('POST', `/projetos/${projeto}/importacao`, { csv: PLANILHA, aplicar: false }, consultora)).status).toBe(403);
  });

  it('200 unidades em menos de 30 s (meta do plano)', async () => {
    const p = (await req('POST', '/projetos', { nome: 'Grande' }, admin)).json.id;
    const linhas = Array.from({ length: 200 }, (_, i) => `Torre G;${Math.floor(i / 8) + 1};${Math.floor(i / 8) + 1}${String((i % 8) + 1).padStart(2, '0')};T${i % 3};${60 + (i % 3) * 10};2;1;1;${500000 + i * 1000};`);
    const inicio = Date.now();
    const r = await req('POST', `/projetos/${p}/importacao`, { csv: [CAB, ...linhas].join('\n'), aplicar: true }, admin);
    const ms = Date.now() - inicio;
    expect(r.status).toBe(200);
    expect(r.json.resumo.unidadesNovas).toBe(200);
    expect(ms).toBeLessThan(30_000);
  });
});

describe('unidades e status', () => {
  let predioA = '';
  let u101 = '';
  let u102 = '';
  let u202 = '';

  it('espelho do prédio: andares de cima para baixo, unidades com tipologia e transições permitidas para quem pergunta', async () => {
    const d = (await req('GET', `/projetos/${projeto}`, undefined, admin)).json;
    predioA = d.predios.find((p: { nome: string }) => p.nome === 'Torre A').id;
    const e = (await req('GET', `/predios/${predioA}`, undefined, consultora)).json;
    expect(e.predio).toMatchObject({ nome: 'Torre A', projetoId: projeto, projetoNome: 'Residencial Paulista' });
    expect(e.andares.map((a: { numero: number }) => a.numero)).toEqual([2, 1]);
    const andar1 = e.andares[1].unidades;
    u101 = andar1.find((u: { codigo: string }) => u.codigo === '101').id;
    u102 = andar1.find((u: { codigo: string }) => u.codigo === '102').id;
    u202 = e.andares[0].unidades.find((u: { codigo: string }) => u.codigo === '202').id;
    expect(andar1.find((u: { codigo: string }) => u.codigo === '102')).toMatchObject({ status: 'disponivel', preco: 890000, tipologia: 'Tipo 3Q', areaM2: 98, quartos: 3, transicoes: ['reservado'] });
  });

  it('consultora reserva e cancela; não vende', async () => {
    expect((await req('POST', `/unidades/${u102}/status`, { status: 'reservado' }, consultora)).status).toBe(200);
    expect((await req('POST', `/unidades/${u102}/status`, { status: 'vendido' }, consultora)).json.erro).toBe('sem_permissao');
    expect((await req('POST', `/unidades/${u102}/status`, { status: 'disponivel' }, consultora)).status).toBe(200);
  });

  it('viewer não muda status; transição inválida e distrato sem motivo são recusados', async () => {
    expect((await req('POST', `/unidades/${u102}/status`, { status: 'reservado' }, viewer)).status).toBe(403);
    const inv = await req('POST', `/unidades/${u202}/status`, { status: 'reservado' }, admin);
    expect([inv.status, inv.json.erro]).toEqual([409, 'transicao_invalida']);
    const semMotivo = await req('POST', `/unidades/${u202}/status`, { status: 'disponivel' }, admin);
    expect([semMotivo.status, semMotivo.json.erro]).toEqual([400, 'motivo_obrigatorio']);
    expect((await req('POST', `/unidades/${u202}/status`, { status: 'disponivel', motivo: 'Distrato assinado' }, admin)).status).toBe(200);
  });

  it('histórico guarda quem, de, para e motivo; outbox recebe o evento', async () => {
    const h = (await req('GET', `/unidades/${u202}/historico`, undefined, admin)).json;
    expect(h[0]).toMatchObject({ de: 'vendido', para: 'disponivel', motivo: 'Distrato assinado' });
    expect(h[0].usuario).toBe('Admin');
    const ev = await owner.query("SELECT tipo, dados FROM eventos WHERE entidade_id = $1 ORDER BY id DESC LIMIT 1", [u202]);
    expect(ev.rows[0]).toMatchObject({ tipo: 'unidade.status_alterado', dados: { de: 'vendido', para: 'disponivel' } });
  });

  it('outra empresa não vê nem altera a unidade', async () => {
    expect((await req('GET', `/predios/${predioA}`, undefined, outraEmpresa)).status).toBe(404);
    expect((await req('POST', `/unidades/${u101}/status`, { status: 'vendido' }, outraEmpresa)).status).toBe(404);
  });

  it('cadastro manual: prédio com andares, tipologia, unidade e edição de preço', async () => {
    const p = await req('POST', `/projetos/${projeto}/predios`, { nome: 'Torre C', andares: 3, incluirTerreo: true }, admin);
    expect(p.status).toBe(201);
    const e = (await req('GET', `/predios/${p.json.id}`, undefined, admin)).json;
    expect(e.andares.map((a: { nome: string }) => a.nome)).toEqual(['3º andar', '2º andar', '1º andar', 'Térreo']);
    expect((await req('POST', `/projetos/${projeto}/predios`, { nome: 'Torre C', andares: 1 }, admin)).status).toBe(409);

    const t = await req('POST', `/projetos/${projeto}/tipologias`, { nome: 'Studio', areaM2: 32, quartos: 1, suites: 0, vagas: 0 }, admin);
    expect(t.status).toBe(201);
    const u = await req('POST', `/predios/${p.json.id}/unidades`, { codigo: '301', andar: 3, tipologiaId: t.json.id, preco: 400000 }, admin);
    expect(u.status).toBe(201);
    expect((await req('POST', `/predios/${p.json.id}/unidades`, { codigo: '999', andar: 9 }, admin)).json.erro).toBe('andar_inexistente');
    expect((await req('PATCH', `/unidades/${u.json.id}`, { preco: 410000.5 }, admin)).json.preco).toBe(410000.5);
  });

  it('tipologia de outro empreendimento é recusada na unidade', async () => {
    const outro = (await req('POST', '/projetos', { nome: 'Outro' }, admin)).json.id;
    const t = (await req('POST', `/projetos/${outro}/tipologias`, { nome: 'Loft', areaM2: 40, quartos: 1, suites: 0, vagas: 0 }, admin)).json.id;
    expect((await req('PATCH', `/unidades/${u101}`, { tipologiaId: t }, admin)).json.erro).toBe('tipologia_de_outro_empreendimento');
  });
});
