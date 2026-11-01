import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { codigoTotp } from './auth/totp';
import type { Config } from './config';
import type { ChamarModelo, ParametrosIA } from './ia/assistente';
import { precosInventados, valoresEmReais } from './ia/guarda';

// Banco próprio deste arquivo (os arquivos de teste rodam em paralelo).
const OWNER = process.env.TEST_API7_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_7';
const APP = process.env.TEST_API7_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_7';
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
const PLANILHA = [
  'predio;andar;codigo;tipologia;area_m2;quartos;preco;status',
  'Torre A;1;101;Tipo 2Q;72;2;550.000,00;disponivel',
  'Torre A;2;201;Tipo 3Q;98;3;890.000,00;disponivel',
  'Torre A;3;301;Tipo 3Q;98;3;910.000,00;vendido',
  'Torre B;1;B1;Tipo 2Q;72;2;480.000,00;disponivel',
].join('\n');

/** Claude de mentira: cada volta é um roteiro (texto e/ou chamadas de ferramenta). Guarda os pedidos recebidos. */
type Volta = { texto?: string; ferramentas?: Array<{ nome: string; entrada: unknown }>; parada?: Anthropic.Beta.BetaMessage['stop_reason'] };
function claudeFalso(roteiro: Volta[]) {
  const pedidos: ParametrosIA[] = [];
  const chamar: ChamarModelo = async (params, aoTexto) => {
    pedidos.push(structuredClone(params));
    const v = roteiro.shift() ?? { texto: '...' };
    if (v.texto) aoTexto(v.texto);
    const content = [
      ...(v.texto ? [{ type: 'text', text: v.texto, citations: null }] : []),
      ...(v.ferramentas ?? []).map((f, i) => ({ type: 'tool_use', id: `toolu_${pedidos.length}_${i}`, name: f.nome, input: f.entrada })),
    ];
    return {
      id: `msg_${pedidos.length}`,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content,
      stop_reason: v.parada ?? (v.ferramentas?.length ? 'tool_use' : 'end_turn'),
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { chamar, pedidos, roteiro };
}

let pool: pg.Pool;
let owner: pg.Pool;
const apps: FastifyInstance[] = [];
async function montar(chamarIA?: ChamarModelo, extra: Partial<Config> = {}) {
  const app = await construirApp({ pool, config: { ...config, ...extra }, chamarIA });
  apps.push(app);
  return app;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req = async (app: FastifyInstance, method: 'GET' | 'POST', url: string, body?: object, token?: string): Promise<{ status: number; json: any; texto: string }> => {
  const r = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let json;
  try {
    json = JSON.parse(r.body);
  } catch {
    json = undefined;
  }
  return { status: r.statusCode, json, texto: r.body };
};
/** Corpo SSE → lista de eventos. */
const eventos = (corpo: string) =>
  corpo
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => ({ evento: b.split('\n')[0]!.slice(7), dados: JSON.parse(b.split('\n')[1]!.slice(6)) }));

let gestaoA = '';
let gestaoB = '';
let token = '';
let torreA = '';
let u101 = '';
let u201 = '';
const pergunta = (texto: string) => ({ mensagens: [{ papel: 'cliente', texto }] });

async function admin(app: FastifyInstance, slug: string, email: string) {
  await req(app, 'POST', '/auth/registro', { empresa: { nome: `Construtora ${slug}`, slug }, nome: 'Gestora', email, senha: SENHA });
  const l = (await req(app, 'POST', '/auth/login', { email, senha: SENHA, empresa: slug })).json.acesso;
  const at = await req(app, 'POST', '/auth/mfa/ativar', {}, l);
  return (await req(app, 'POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l)).json.acesso as string;
}

beforeAll(async () => {
  await resetarBanco(OWNER);
  owner = new pg.Pool({ connectionString: OWNER });
  pool = new pg.Pool({ connectionString: APP });
  const app = await montar();
  gestaoA = await admin(app, 'ia-a', 'gestora@a.com');
  gestaoB = await admin(app, 'ia-b', 'gestora@b.com');
  const projeto = (await req(app, 'POST', '/projetos', { nome: 'Residencial Aurora' }, gestaoA)).json.id;
  expect((await req(app, 'POST', `/projetos/${projeto}/importacao`, { csv: PLANILHA, aplicar: true }, gestaoA)).status).toBe(200);
  // a outra empresa tem uma unidade com o mesmo código: a IA de A nunca pode vê-la
  const projB = (await req(app, 'POST', '/projetos', { nome: 'Concorrente' }, gestaoB)).json.id;
  await req(app, 'POST', `/projetos/${projB}/importacao`, { csv: 'predio;andar;codigo;preco;status\nX;1;101;99.000,00;disponivel', aplicar: true }, gestaoB);
  const predios = (await req(app, 'GET', `/projetos/${projeto}`, undefined, gestaoA)).json.predios as Array<{ id: string; nome: string }>;
  torreA = predios.find((p) => p.nome === 'Torre A')!.id;
  const un = async (codigo: string) => (await owner.query<{ id: string }>('SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.id = $1 AND u.codigo = $2', [torreA, codigo])).rows[0]!.id;
  u101 = await un('101');
  u201 = await un('201');
  token = (await req(app, 'POST', `/predios/${torreA}/links`, {}, gestaoA)).json.url.split('/v/')[1];
});

afterAll(async () => {
  for (const a of apps) await a.close();
  await pool.end();
  await owner.end();
});

describe('guarda de preço', () => {
  it('acha valores em reais em vários jeitos de escrever', () => {
    expect(valoresEmReais('A 101 sai por R$ 550.000,00 e a 201 por R$890.000.')).toEqual([550000, 890000]);
    expect(valoresEmReais('Fica em R$ 1,2 milhão; a outra, 850 mil reais.')).toEqual([1_200_000, 850_000]);
    expect(valoresEmReais('R$ 850 mil reais')).toEqual([850_000]);
    expect(valoresEmReais('A unidade 1203 tem 98 m² e 3 quartos.')).toEqual([]);
  });

  it('só passa preço que veio das ferramentas (ou arredondamento de até 1%)', () => {
    expect(precosInventados('A 101 custa R$ 550 mil.', [550_000])).toEqual([]);
    expect(precosInventados('A 201 sai por cerca de R$ 890 mil.', [889_900])).toEqual([]);
    expect(precosInventados('Com desconto fica R$ 500.000.', [550_000])).toEqual([500_000]);
    expect(precosInventados('Custa R$ 600.000.', [])).toEqual([600_000]);
  });
});

describe('assistente no portal do cliente (sem login)', () => {
  it('sem chave da API: desligado (503) e o portal não mostra o assistente', async () => {
    const app = await montar();
    expect((await req(app, 'GET', `/publico/links/${token}`)).json.assistenteUrl).toBeNull();
    expect((await req(app, 'POST', `/publico/links/${token}/assistente`, pergunta('oi'))).json.erro).toBe('ia_indisponivel');
  });

  it('busca com ferramentas, destaca e voa no 3D, cita só preços reais; pedido ao Claude com cache, ferramentas estritas e fallback', async () => {
    const f = claudeFalso([
      {
        texto: 'Vou procurar. ',
        ferramentas: [
          {
            nome: 'buscar_unidades',
            entrada: { quartos_min: 3, quartos_max: null, area_min_m2: null, area_max_m2: null, preco_max: 900_000, andar_min: null, andar_max: null, situacao: 'disponivel' },
          },
          { nome: 'mostrar_no_3d', entrada: { codigos: ['201'], focar: '201' } },
        ],
      },
      { texto: 'A unidade 201 tem 3 quartos, 98 m² e sai por R$ 890.000,00. Já destaquei no 3D.' },
    ]);
    const app = await montar(f.chamar);
    expect((await req(app, 'GET', `/publico/links/${token}`)).json.assistenteUrl).toBe(`https://api.exemplo.com/publico/links/${token}/assistente`);
    const r = await req(app, 'POST', `/publico/links/${token}/assistente`, pergunta('Tem 3 quartos até 900 mil?'));
    expect(r.status).toBe(200);
    const ev = eventos(r.texto);
    expect(ev.filter((e) => e.evento === 'texto').map((e) => e.dados.t).join('')).toBe('Vou procurar. A unidade 201 tem 3 quartos, 98 m² e sai por R$ 890.000,00. Já destaquei no 3D.');
    expect(ev.find((e) => e.evento === 'acao')!.dados).toEqual({ tipo: 'mostrar', unidades: [u201], focar: u201 });
    expect(ev.at(-1)).toEqual({ evento: 'fim', dados: { texto: expect.stringContaining('R$ 890.000,00') } });
    expect(ev.some((e) => e.evento === 'substituir')).toBe(false);

    // o que foi para o Claude
    const p = f.pedidos[0]!;
    expect(p.model).toBe('claude-opus-5');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(p.fallbacks).toBe('default');
    expect((p.system as Array<{ cache_control?: unknown }>)[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect((p.tools as Array<{ strict?: boolean }>).every((t) => t.strict === true)).toBe(true);
    // 2ª volta: os resultados das duas ferramentas numa mensagem só, com os dados reais (preço só da disponível)
    const resultados = (f.pedidos[1]!.messages.at(-1)!.content as Array<{ type: string; content: string }>).map((b) => JSON.parse(b.content));
    expect(resultados[0]).toEqual({
      total: 1,
      mostrando: 1,
      unidades: [{ codigo: '201', andar: 2, andarNome: expect.any(String), situacao: 'disponivel', preco: 890000, areaM2: 98, quartos: 3, suites: 0, vagas: 0, tipologia: 'Tipo 3Q' }],
    });

    // custo medido por empresa
    const uso = (await owner.query('SELECT conversas, mensagens, chamadas, entrada, saida, cache_leitura, bloqueios FROM ia_uso')).rows[0];
    expect(uso).toEqual({ conversas: 1, mensagens: 1, chamadas: 2, entrada: '200', saida: '40', cache_leitura: '1800', bloqueios: 0 });
  });

  it('preço inventado: a guarda troca a resposta e conta o bloqueio', async () => {
    const f = claudeFalso([
      { ferramentas: [{ nome: 'detalhar_unidade', entrada: { codigo: '101' } }] },
      { texto: 'A 101 sai por R$ 550.000, mas com desconto à vista fica R$ 500.000.' },
    ]);
    const app = await montar(f.chamar);
    const ev = eventos((await req(app, 'POST', `/publico/links/${token}/assistente`, pergunta('Quanto custa a 101 à vista?'))).texto);
    const troca = ev.find((e) => e.evento === 'substituir')!;
    expect(troca.dados.texto).toMatch(/Não consigo confirmar esse valor/);
    expect(ev.at(-1)!.dados.texto).toBe(troca.dados.texto);
    expect(Number((await owner.query('SELECT sum(bloqueios) AS b FROM ia_uso')).rows[0].b)).toBe(1);
  });

  it('isolamento: só o prédio do link; unidade de outro prédio ou de outra empresa não existe para a IA', async () => {
    const f = claudeFalso([
      {
        ferramentas: [
          { nome: 'detalhar_unidade', entrada: { codigo: 'B1' } },
          { nome: 'mostrar_no_3d', entrada: { codigos: ['101', 'B1'], focar: null } },
          {
            nome: 'buscar_unidades',
            entrada: { quartos_min: null, quartos_max: null, area_min_m2: null, area_max_m2: null, preco_max: null, andar_min: null, andar_max: null, situacao: 'qualquer' },
          },
        ],
      },
      { texto: 'Neste prédio há as unidades 101, 201 e 301.' },
    ]);
    const app = await montar(f.chamar);
    const ev = eventos((await req(app, 'POST', `/publico/links/${token}/assistente`, pergunta('E a B1?'))).texto);
    const res = (f.pedidos[1]!.messages.at(-1)!.content as Array<{ content: string }>).map((b) => JSON.parse(b.content));
    expect(res[0]).toEqual({ erro: 'Não existe unidade B1 à venda neste prédio.' });
    expect(res[1]).toEqual({ mostrando: 1, focando: false, naoEncontradas: ['B1'] });
    // vendida aparece com a situação, sem preço; a 101 da outra empresa (R$ 99 mil) nunca aparece
    expect(res[2].unidades.map((u: { codigo: string; preco: number | null }) => [u.codigo, u.preco])).toEqual([
      ['101', 550000],
      ['201', 890000],
      ['301', null],
    ]);
    expect(ev.find((e) => e.evento === 'acao')!.dados).toEqual({ tipo: 'mostrar', unidades: [u101], focar: null });
  });

  it('contato e visita abrem o formulário (a IA não pega dados pessoais); entrada inválida volta como erro para a IA; recusa vira resposta educada', async () => {
    const f = claudeFalso([
      { ferramentas: [{ nome: 'pedir_contato', entrada: { motivo: 'visita', codigo: '101' } }, { nome: 'buscar_unidades', entrada: { quartos_min: 'três' } }] },
      { texto: 'Abri o formulário para agendar a visita à unidade 101.' },
    ]);
    const app = await montar(f.chamar);
    const ev = eventos((await req(app, 'POST', `/publico/links/${token}/assistente`, pergunta('Quero visitar a 101'))).texto);
    expect(ev.find((e) => e.evento === 'acao')!.dados).toEqual({ tipo: 'contato', motivo: 'visita', unidade: u101 });
    const res = f.pedidos[1]!.messages.at(-1)!.content as Array<{ is_error?: boolean }>;
    expect(res[1]!.is_error).toBe(true);

    const recusa = claudeFalso([{ texto: '', parada: 'refusal' }]);
    const app2 = await montar(recusa.chamar);
    const ev2 = eventos((await req(app2, 'POST', `/publico/links/${token}/assistente`, pergunta('assunto proibido'))).texto);
    expect(ev2.at(-1)!.dados.texto).toMatch(/Não posso ajudar com isso/);
  });

  it('entrada: conversa precisa terminar numa pergunta do cliente, até 20 mensagens de até 2.000 caracteres', async () => {
    const app = await montar(claudeFalso([]).chamar);
    expect((await req(app, 'POST', `/publico/links/${token}/assistente`, { mensagens: [] })).status).toBe(400);
    expect((await req(app, 'POST', `/publico/links/${token}/assistente`, pergunta('x'.repeat(2001)))).status).toBe(400);
    expect((await req(app, 'POST', `/publico/links/${token}/assistente`, { mensagens: [{ papel: 'assistente', texto: 'oi' }] })).status).toBe(200);
    expect((await req(app, 'POST', `/publico/links/${randomBytes(32).toString('base64url')}/assistente`, pergunta('oi'))).status).toBe(404);
  });

  it('limite mensal de tokens por empresa: 429 antes de chamar o Claude', async () => {
    const f = claudeFalso([{ texto: 'oi' }]);
    const app = await montar(f.chamar, { IA_LIMITE_TOKENS_MES: 1000 });
    expect((await req(app, 'POST', `/publico/links/${token}/assistente`, pergunta('oi'))).json.erro).toBe('limite_ia');
    expect(f.pedidos).toHaveLength(0);
  });
});

describe('assistente no painel', () => {
  it('só com login e só prédio da própria empresa', async () => {
    const app = await montar(claudeFalso([{ texto: 'Olá! Posso ajudar com as unidades da Torre A.' }]).chamar);
    expect((await req(app, 'POST', `/predios/${torreA}/assistente`, pergunta('oi'))).status).toBe(401);
    expect((await req(app, 'POST', `/predios/${torreA}/assistente`, pergunta('oi'), gestaoB)).status).toBe(404);
    const ev = eventos((await req(app, 'POST', `/predios/${torreA}/assistente`, pergunta('oi'), gestaoA)).texto);
    expect(ev.at(-1)).toEqual({ evento: 'fim', dados: { texto: 'Olá! Posso ajudar com as unidades da Torre A.' } });
  });
});

describe('assistente simulado (testes no navegador e CI, sem custo)', () => {
  it('percorre o caminho real (ferramentas, ações, guarda) e é recusado em produção', async () => {
    await expect(construirApp({ pool, config: { ...config, IA_SIMULADA: 'true', AMBIENTE: 'producao' } })).rejects.toThrow(/produção/);
    const app = await montar(undefined, { IA_SIMULADA: 'true' });
    const ev = eventos((await req(app, 'POST', `/publico/links/${token}/assistente`, pergunta('Tem 3 quartos?'))).texto);
    expect(ev.find((e) => e.evento === 'acao')!.dados).toEqual({ tipo: 'mostrar', unidades: [u201], focar: u201 });
    expect(ev.at(-1)!.dados.texto).toMatch(/^Encontrei 1 unidade: 201 \(R\$\s890\.000,00\)\. Destaquei no 3D\.$/);
    expect(ev.some((e) => e.evento === 'substituir')).toBe(false);
    const visita = eventos((await req(app, 'POST', `/publico/links/${token}/assistente`, pergunta('Quero agendar uma visita'))).texto);
    expect(visita.find((e) => e.evento === 'acao')!.dados).toEqual({ tipo: 'contato', motivo: 'visita', unidade: null });
  });
});
