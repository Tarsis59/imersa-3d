import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { resetarBanco } from '@imersa/db/testing';
import { construirApp } from './app';
import { codigoTotp } from './auth/totp';
import { hashSenha } from './auth/senha';
import { entregarWebhooks } from './integracoes/entregas';
import { verificarAssinatura } from './integracoes/assinatura';
import type { Config } from './config';

// Banco próprio deste arquivo (os arquivos de teste rodam em paralelo).
const OWNER = process.env.TEST_API5_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_api_5';
const APP = process.env.TEST_API5_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_api_5';
const TOTP_KEY = randomBytes(32).toString('base64url');
const config: Config = {
  DATABASE_URL: APP,
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!',
  TOTP_KEY,
  PORT: 0,
  CORS_ORIGIN: 'http://localhost:3000',
  WEB_URL: 'http://localhost:3000',
  RATE_LIMIT_AUTH: 1000,
  RATE_LIMIT_GERAL: 300,
  TRUST_PROXY: true,
  AMBIENTE: 'teste',
  API_URL_PUBLICA: 'https://api.exemplo.com',
  WEBHOOK_PERMITIR_LOCAL: true,
};
const SENHA = 'senha-forte-123';
const CONSENTIMENTO = 'Autorizo a empresa a falar comigo sobre este empreendimento.';

let app: FastifyInstance;
let base = '';
let pool: pg.Pool;
let owner: pg.Pool;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resp = { status: number; json: any };
async function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: object, token?: string, ip = '203.0.113.50'): Promise<Resp> {
  const r = await app.inject({ method, url, payload: body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': ip } });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : undefined };
}
async function adminComMfa(slug: string, email: string): Promise<string> {
  await req('POST', '/auth/registro', { empresa: { nome: `Construtora ${slug}`, slug }, nome: 'Gestora', email, senha: SENHA });
  const l = await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug });
  const at = await req('POST', '/auth/mfa/ativar', {}, l.json.acesso);
  return (await req('POST', '/auth/mfa/confirmar', { codigo: codigoTotp(at.json.segredo) }, l.json.acesso)).json.acesso;
}
async function consultora(slug: string, email: string): Promise<string> {
  const t = await owner.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [slug]);
  const u = await owner.query<{ id: string }>("INSERT INTO users (nome, email, senha_hash) VALUES ('Ana Corretora', $1, $2) RETURNING id", [email, await hashSenha(SENHA)]);
  await owner.query("INSERT INTO memberships (tenant_id, user_id, papel) VALUES ($1, $2, 'consultora')", [t.rows[0]!.id, u.rows[0]!.id]);
  return (await req('POST', '/auth/login', { email, senha: SENHA, empresa: slug })).json.acesso;
}
const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre A;1;101;Tipo;70;2;600.000,00;disponivel', 'Torre A;1;102;Tipo;70;2;610.000,00;disponivel', 'Torre B;1;B1;Tipo;70;2;500.000,00;disponivel'].join('\n');

async function empreendimento(token: string, nome: string) {
  const projeto = (await req('POST', '/projetos', { nome }, token)).json.id;
  expect((await req('POST', `/projetos/${projeto}/importacao`, { csv: PLANILHA, aplicar: true }, token)).status).toBe(200);
  const predios = (await req('GET', `/projetos/${projeto}`, undefined, token)).json.predios as Array<{ id: string; nome: string }>;
  const unidade = async (codigo: string) => (await owner.query<{ id: string }>('SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.project_id = $1 AND u.codigo = $2', [projeto, codigo])).rows[0]!.id;
  return { projeto, torreA: predios.find((p) => p.nome === 'Torre A')!.id, torreB: predios.find((p) => p.nome === 'Torre B')!.id, u101: await unidade('101'), u102: await unidade('102'), uB1: await unidade('B1') };
}

/** Lê uma transmissão SSE e espera até aparecer o texto pedido. */
function assistir(url: string) {
  const ctrl = new AbortController();
  let texto = '';
  const pronto = fetch(url, { signal: ctrl.signal }).then(async (r) => {
    if (r.status !== 200) return r.status;
    void (async () => {
      const leitor = r.body!.getReader();
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await leitor.read();
          if (done) break;
          texto += dec.decode(value, { stream: true });
        }
      } catch {
        /* fechado pelo teste */
      }
    })();
    return 200;
  });
  return {
    pronto,
    texto: () => texto,
    async esperar(trecho: string, ms = 5000): Promise<number> {
      const inicio = Date.now();
      while (!texto.includes(trecho)) {
        if (Date.now() - inicio > ms) throw new Error(`não chegou "${trecho}" em ${ms} ms; recebido: ${texto}`);
        await new Promise((r) => setTimeout(r, 20));
      }
      return Date.now() - inicio;
    },
    fechar: () => ctrl.abort(),
  };
}

let gestao = '';
let ana = '';
let outra = '';
let emp: Awaited<ReturnType<typeof empreendimento>>;
let empOutra: Awaited<ReturnType<typeof empreendimento>>;

beforeAll(async () => {
  await resetarBanco(OWNER);
  pool = new pg.Pool({ connectionString: APP });
  owner = new pg.Pool({ connectionString: OWNER });
  app = await construirApp({ pool, config });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  gestao = await adminComMfa('construtora', 'g@c.com');
  ana = await consultora('construtora', 'ana@c.com');
  outra = await adminComMfa('concorrente', 'g@x.com');
  emp = await empreendimento(gestao, 'Residencial Sol');
  empOutra = await empreendimento(outra, 'Concorrente Park');
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await owner?.end();
});

const naApi = (url: string) => url.replace('https://api.exemplo.com', base);
const mudarStatus = (token: string, unidade: string, status: string) => req('POST', `/unidades/${unidade}/status`, { status }, token);

describe('status ao vivo (SSE)', () => {
  it('a mudança chega em menos de 2 s, só para o prédio certo', async () => {
    const t = await req('POST', `/predios/${emp.torreA}/ao-vivo`, {}, ana);
    expect(t.status).toBe(200);
    expect(t.json.url).toMatch(/^https:\/\/api\.exemplo\.com\/ao-vivo\?ticket=/);
    const sse = assistir(naApi(t.json.url));
    expect(await sse.pronto).toBe(200);
    await sse.esperar(': conectado');

    // outro prédio e outra empresa mudam: nada chega aqui
    expect((await mudarStatus(gestao, emp.uB1, 'reservado')).status).toBe(200);
    expect((await mudarStatus(outra, empOutra.u101, 'reservado')).status).toBe(200);
    const inicio = Date.now();
    expect((await mudarStatus(gestao, emp.u101, 'reservado')).status).toBe(200);
    await sse.esperar(`"id":"${emp.u101}","status":"reservado"`);
    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(sse.texto()).not.toContain(emp.uB1);
    expect(sse.texto()).not.toContain(empOutra.u101);
    expect(sse.texto()).toContain('event: unidade');
    sse.fechar();
  });

  it('bilhete: falso ou alterado → 401; não serve como login; prédio de outra empresa → 404', async () => {
    expect((await fetch(`${base}/ao-vivo?ticket=${'x'.repeat(40)}`)).status).toBe(401);
    const t = (await req('POST', `/predios/${emp.torreA}/ao-vivo`, {}, ana)).json.url as string;
    const ticket = new URL(t).searchParams.get('ticket')!;
    expect((await fetch(`${base}/ao-vivo?ticket=${ticket.slice(0, -2)}xx`)).status).toBe(401);
    expect((await req('GET', '/projetos', undefined, ticket)).status).toBe(401);
    expect((await req('POST', `/predios/${empOutra.torreA}/ao-vivo`, {}, ana)).status).toBe(404);
    expect((await req('POST', `/predios/${emp.torreA}/ao-vivo`, {})).status).toBe(401);
  });

  it('o cliente do portal também recebe (pelo próprio link); link revogado não transmite', async () => {
    const link = (await req('POST', `/predios/${emp.torreA}/links`, {}, ana)).json;
    const token = link.url.split('/v/')[1];
    const portal = (await req('GET', `/publico/links/${token}`)).json;
    expect(portal.aoVivoUrl).toBe(`https://api.exemplo.com/publico/links/${token}/ao-vivo`);
    const sse = assistir(naApi(portal.aoVivoUrl));
    expect(await sse.pronto).toBe(200);
    await sse.esperar(': conectado');
    await mudarStatus(gestao, emp.u102, 'vendido');
    await sse.esperar(`"id":"${emp.u102}","status":"vendido"`);
    sse.fechar();
    await req('POST', `/links/${link.id}/revogar`, {}, ana);
    expect((await fetch(naApi(portal.aoVivoUrl))).status).toBe(410);
  });

  it('tour guiado ao vivo: a câmera da consultora chega só a quem assiste aquele link', async () => {
    const link = (await req('POST', `/predios/${emp.torreA}/links`, {}, ana)).json;
    const outro = (await req('POST', `/predios/${emp.torreA}/links`, {}, ana)).json;
    const cliente = assistir(naApi((await req('GET', `/publico/links/${link.url.split('/v/')[1]}`)).json.aoVivoUrl));
    const vizinho = assistir(naApi((await req('GET', `/publico/links/${outro.url.split('/v/')[1]}`)).json.aoVivoUrl));
    expect(await cliente.pronto).toBe(200);
    expect(await vizinho.pronto).toBe(200);
    await cliente.esperar(': conectado');
    await vizinho.esperar(': conectado');
    const pose = { ativo: true, posicao: [10, 20, 30], alvo: [0, 5, 0], unidade: emp.u101 };
    expect((await req('POST', `/links/${link.id}/conducao`, pose, ana)).status).toBe(204);
    await cliente.esperar('event: conducao');
    await cliente.esperar('"posicao":[10,20,30]');
    expect(cliente.texto()).toContain(emp.u101);
    expect(vizinho.texto()).not.toContain('conducao');
    // outra empresa, entrada inválida e link revogado
    expect((await req('POST', `/links/${link.id}/conducao`, pose, outra)).status).toBe(404);
    expect((await req('POST', `/links/${link.id}/conducao`, { ativo: true, posicao: [1, 2] }, ana)).status).toBe(400);
    expect((await req('POST', `/links/${link.id}/conducao`, { ativo: true, posicao: [1e9, 0, 0] }, ana)).status).toBe(400);
    expect((await req('POST', `/links/${link.id}/conducao`, { ativo: false }, ana)).status).toBe(204);
    await cliente.esperar('"ativo":false');
    cliente.fechar();
    vizinho.fechar();
    await req('POST', `/links/${link.id}/revogar`, {}, ana);
    expect((await req('POST', `/links/${link.id}/conducao`, pose, ana)).status).toBe(404);
  });
});

describe('integrações (chaves de API e webhooks)', () => {
  it('só a gestão gerencia', async () => {
    expect((await req('GET', '/integracoes', undefined, ana)).status).toBe(403);
    expect((await req('POST', '/integracoes/chaves', { nome: 'CRM' }, ana)).status).toBe(403);
    expect((await req('GET', '/integracoes', undefined, gestao)).status).toBe(200);
  });

  it('API pública com chave: cada empresa vê só o que é dela; chave revogada ou falsa → 401', async () => {
    const nova = await req('POST', '/integracoes/chaves', { nome: 'RD Station' }, gestao);
    expect(nova.status).toBe(201);
    expect(nova.json.chave).toMatch(/^imk_[\w-]{43}$/);
    const daOutra = (await req('POST', '/integracoes/chaves', { nome: 'CRM X' }, outra)).json.chave;
    const salvo = (await owner.query('SELECT prefixo, hash FROM chaves_api WHERE id = $1', [nova.json.id])).rows[0];
    expect(salvo.prefixo).toBe(nova.json.chave.slice(0, 12));
    expect(salvo.hash).not.toContain(nova.json.chave);

    const t = (await req('POST', `/predios/${emp.torreA}/links`, {}, ana)).json.url.split('/v/')[1];
    await req('POST', `/publico/links/${t}/leads`, { nome: 'Lia Souza', email: 'lia@x.com', consentimento: true, textoConsentimento: CONSENTIMENTO });
    const leads = await req('GET', '/v1/leads', undefined, nova.json.chave);
    expect(leads.status).toBe(200);
    expect(leads.json).toEqual([expect.objectContaining({ nome: 'Lia Souza', empreendimento: 'Residencial Sol', predio: 'Torre A', consultora: 'Ana Corretora' })]);
    expect((await req('GET', '/v1/leads', undefined, daOutra)).json).toEqual([]);
    const desde = leads.json[0].criadoEm;
    expect((await req('GET', `/v1/leads?desde=${encodeURIComponent(desde)}`, undefined, nova.json.chave)).json).toEqual([]);

    const unidades = (await req('GET', `/v1/unidades?predioId=${emp.torreA}`, undefined, nova.json.chave)).json;
    expect(unidades.map((u: { codigo: string }) => u.codigo)).toEqual(['101', '102']);
    expect((await req('GET', '/v1/empreendimentos', undefined, nova.json.chave)).json).toEqual([expect.objectContaining({ nome: 'Residencial Sol', predios: expect.arrayContaining([expect.objectContaining({ nome: 'Torre A' })]) })]);
    expect((await owner.query('SELECT ultimo_uso FROM chaves_api WHERE id = $1', [nova.json.id])).rows[0].ultimo_uso).not.toBeNull();

    expect((await req('GET', '/v1/leads')).status).toBe(401);
    expect((await req('GET', '/v1/leads', undefined, `imk_${randomBytes(32).toString('base64url')}`)).status).toBe(401);
    expect((await req('GET', '/v1/leads', undefined, gestao)).status).toBe(401); // token de login não é chave de API
    await req('POST', `/integracoes/chaves/${nova.json.id}/revogar`, {}, gestao);
    expect((await req('GET', '/v1/leads', undefined, nova.json.chave)).status).toBe(401);
  });

  it('webhook só para https público (o modo estrito recusa rede local e http)', async () => {
    const estrito = await construirApp({ pool, config: { ...config, WEBHOOK_PERMITIR_LOCAL: false } });
    try {
      for (const url of ['http://exemplo.com/gancho', 'https://127.0.0.1/gancho', 'https://10.1.2.3/gancho', 'https://169.254.169.254/latest']) {
        const r = await estrito.inject({ method: 'POST', url: '/integracoes/webhooks', payload: { url, eventos: ['lead.criado'] }, headers: { authorization: `Bearer ${gestao}` } });
        expect(r.statusCode, url).toBe(400);
        expect(JSON.parse(r.body).erro).toBe('destino_invalido');
      }
    } finally {
      await estrito.close();
    }
  });

  describe('entrega assinada com retentativa', () => {
    let receptor: Server;
    let recebidos: Array<{ headers: IncomingHttpHeaders; corpo: string }> = [];
    let responder = 200;
    let url = '';
    beforeAll(async () => {
      receptor = createServer((r, s) => {
        let corpo = '';
        r.on('data', (c) => (corpo += c));
        r.on('end', () => {
          recebidos.push({ headers: r.headers, corpo });
          s.writeHead(responder).end();
        });
      });
      await new Promise<void>((ok) => receptor.listen(0, '127.0.0.1', ok));
      url = `http://127.0.0.1:${(receptor.address() as AddressInfo).port}/crm`;
    });
    afterAll(() => new Promise<void>((ok) => receptor.close(() => ok())));
    const entregar = () => entregarWebhooks(pool, TOTP_KEY, { permitirLocal: true });

    it('lead novo e mudança de status chegam assinados; eventos de outra empresa não', async () => {
      const w = await req('POST', '/integracoes/webhooks', { url, eventos: ['lead.criado', 'unidade.status'] }, gestao);
      expect(w.status).toBe(201);
      expect(w.json.segredo).toMatch(/^whsec_/);
      expect((await owner.query('SELECT segredo_cifrado FROM webhooks WHERE id = $1', [w.json.id])).rows[0].segredo_cifrado).not.toContain(w.json.segredo);
      recebidos = [];

      const t = (await req('POST', `/predios/${emp.torreB}/links`, {}, ana)).json.url.split('/v/')[1];
      await req('POST', `/publico/links/${t}/leads`, { nome: 'Rui Prado', telefone: '11 98888-1111', unidadeId: emp.uB1, consentimento: true, textoConsentimento: CONSENTIMENTO });
      await mudarStatus(gestao, emp.uB1, 'vendido');
      await mudarStatus(outra, empOutra.u102, 'vendido');
      expect(await entregar()).toBe(2);
      expect(recebidos).toHaveLength(2);
      for (const r of recebidos) expect(verificarAssinatura(w.json.segredo, String(r.headers['x-imersa-assinatura']), r.corpo)).toBe(true);
      const lead = recebidos.find((r) => r.headers['x-imersa-evento'] === 'lead.criado')!;
      expect(JSON.parse(lead.corpo)).toMatchObject({ evento: 'lead.criado', dados: { nome: 'Rui Prado', telefone: '11 98888-1111', unidade: 'B1', predio: 'Torre B', empreendimento: 'Residencial Sol', consultora: 'Ana Corretora' } });
      const status = recebidos.find((r) => r.headers['x-imersa-evento'] === 'unidade.status')!;
      expect(JSON.parse(status.corpo)).toMatchObject({ dados: { codigo: 'B1', de: 'reservado', para: 'vendido' } });
      // um corpo alterado no caminho não passa na conferência
      expect(verificarAssinatura(w.json.segredo, String(lead.headers['x-imersa-assinatura']), lead.corpo.replace('Rui', 'Zé'))).toBe(false);
      expect(await entregar()).toBe(0); // entregues não repetem
      const lista = (await req('GET', `/integracoes/webhooks/${w.json.id}/entregas`, undefined, gestao)).json;
      expect(lista.every((e: { status: string }) => e.status === 'entregue')).toBe(true);
      await req('DELETE', `/integracoes/webhooks/${w.json.id}`, undefined, gestao);
    });

    it('CRM fora do ar: tenta de novo com espera crescente e desiste depois de 8 tentativas', async () => {
      const w = (await req('POST', '/integracoes/webhooks', { url, eventos: ['unidade.status'] }, gestao)).json;
      responder = 503;
      recebidos = [];
      await mudarStatus(gestao, emp.u101, 'disponivel');
      expect(await entregar()).toBe(1);
      const e1 = (await owner.query("SELECT status, tentativas, ultimo_status, proxima_em - now() AS espera FROM webhook_entregas WHERE webhook_id = $1", [w.id])).rows[0];
      expect(e1).toMatchObject({ status: 'pendente', tentativas: 1, ultimo_status: 503 });
      const segundos = (i: { seconds?: number; minutes?: number }) => (i.minutes ?? 0) * 60 + (i.seconds ?? 0);
      expect(segundos(e1.espera)).toBeGreaterThan(25);
      expect(segundos(e1.espera)).toBeLessThanOrEqual(30);
      expect(await entregar()).toBe(0); // ainda não venceu

      await owner.query("UPDATE webhook_entregas SET proxima_em = now() WHERE webhook_id = $1", [w.id]);
      expect(await entregar()).toBe(1);
      const e2 = (await owner.query('SELECT tentativas, proxima_em - now() AS espera FROM webhook_entregas WHERE webhook_id = $1', [w.id])).rows[0];
      expect(e2.tentativas).toBe(2);
      expect(segundos(e2.espera)).toBeGreaterThan(55); // dobrou

      await owner.query("UPDATE webhook_entregas SET proxima_em = now(), tentativas = 7 WHERE webhook_id = $1", [w.id]);
      expect(await entregar()).toBe(1);
      expect((await owner.query('SELECT status, tentativas FROM webhook_entregas WHERE webhook_id = $1', [w.id])).rows[0]).toMatchObject({ status: 'falhou', tentativas: 8 });

      // voltou: a próxima mudança é entregue normalmente; e o botão "testar" também
      responder = 200;
      await mudarStatus(gestao, emp.u101, 'reservado');
      expect((await req('POST', `/integracoes/webhooks/${w.id}/testar`, {}, gestao)).status).toBe(202);
      expect(await entregar()).toBe(2);
      expect(recebidos.map((r) => r.headers['x-imersa-evento']).sort()).toEqual(expect.arrayContaining(['teste', 'unidade.status']));
      const painel = (await req('GET', '/integracoes', undefined, gestao)).json.webhooks.find((x: { id: string }) => x.id === w.id);
      expect(painel).toMatchObject({ entregues: 2, falhas: 1, pendentes: 0 });
      await req('DELETE', `/integracoes/webhooks/${w.id}`, undefined, gestao);
    });

    it('endereço que passou a apontar para a rede interna: não envia e não insiste', async () => {
      const w = (await req('POST', '/integracoes/webhooks', { url, eventos: ['unidade.status'] }, gestao)).json;
      await owner.query("UPDATE webhooks SET url = 'https://10.0.0.7/crm' WHERE id = $1", [w.id]);
      recebidos = [];
      await mudarStatus(gestao, emp.u101, 'disponivel');
      expect(await entregarWebhooks(pool, TOTP_KEY, { permitirLocal: false })).toBe(1);
      expect(recebidos).toHaveLength(0);
      expect((await owner.query('SELECT status, ultimo_erro FROM webhook_entregas WHERE webhook_id = $1', [w.id])).rows[0]).toMatchObject({ status: 'falhou', ultimo_erro: expect.stringContaining('bloqueado') });
    });
  });
});

describe('anti-abuso', () => {
  it('robô que preenche o campo escondido recebe "ok" mas nada é gravado', async () => {
    const t = (await req('POST', `/predios/${emp.torreA}/links`, {}, ana)).json.url.split('/v/')[1];
    const antes = Number((await owner.query('SELECT count(*) FROM leads')).rows[0].count);
    const r = await req('POST', `/publico/links/${t}/leads`, { nome: 'Bot', email: 'b@b.com', site: 'http://spam', consentimento: true, textoConsentimento: CONSENTIMENTO }, undefined, '198.51.100.1');
    expect(r.status).toBe(201);
    expect(Number((await owner.query('SELECT count(*) FROM leads')).rows[0].count)).toBe(antes);
  });

  it('um link só aceita 20 pedidos por hora, mesmo vindo de muitos IPs', async () => {
    const t = (await req('POST', `/predios/${emp.torreA}/links`, {}, ana)).json.url.split('/v/')[1];
    const status: number[] = [];
    for (let i = 0; i < 22; i++) {
      status.push((await req('POST', `/publico/links/${t}/leads`, { nome: `Pessoa ${i}`, email: `p${i}@x.com`, consentimento: true, textoConsentimento: CONSENTIMENTO }, undefined, `192.0.2.${i + 1}`)).status);
    }
    expect(status.filter((s) => s === 201)).toHaveLength(20);
    expect(status.slice(20)).toEqual([429, 429]);
  });

  it('carga: 400 pedidos (50 simultâneos) no portal não derrubam a API (sobra 429, nenhum 5xx)', async () => {
    const t = (await req('POST', `/predios/${emp.torreA}/links`, {}, ana)).json.url.split('/v/')[1];
    // ondas de 50 simultâneos (o Windows recusa conexões além da fila do sistema quando chegam 400 de uma vez)
    const respostas: number[] = [];
    for (let onda = 0; onda < 8; onda++) {
      respostas.push(...(await Promise.all(Array.from({ length: 50 }, () => fetch(`${base}/publico/links/${t}`, { headers: { 'x-forwarded-for': '203.0.113.200' } }).then((r) => r.status)))));
    }
    expect(respostas.filter((s) => s >= 500)).toHaveLength(0);
    expect(respostas.filter((s) => s === 200).length).toBe(120);
    expect(respostas.filter((s) => s === 429).length).toBe(280);
    const inicio = Date.now();
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect(Date.now() - inicio).toBeLessThan(1000);
  });
});

describe('CRM → 3D (situação das unidades pela API pública)', () => {
  it('em lote e idempotente, por id ou pelo código do CRM; chega ao 3D ao vivo; outra empresa não acha', async () => {
    const chave = (await req('POST', '/integracoes/chaves', { nome: 'CRM da construtora' }, gestao)).json.chave as string;
    const daOutra = (await req('POST', '/integracoes/chaves', { nome: 'CRM X' }, outra)).json.chave as string;
    const t = (await req('POST', `/predios/${emp.torreA}/ao-vivo`, {}, ana)).json.url;
    const sse = assistir(naApi(t));
    expect(await sse.pronto).toBe(200);
    await sse.esperar(': conectado');

    // 1º envio: vincula o código do CRM e muda a situação (o 3D recebe na hora)
    const inicio = Date.now();
    const r = await req('POST', '/v1/unidades/status', { unidades: [{ id: emp.u101, crmId: 'CRM-101', status: 'vendido', motivo: 'contrato assinado' }] }, chave);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ atualizadas: 1, semMudanca: 0, naoEncontradas: 0 });
    await sse.esperar(`"id":"${emp.u101}","status":"vendido"`);
    expect(Date.now() - inicio).toBeLessThan(60_000);
    sse.fechar();
    const hist = (await owner.query('SELECT para, motivo, user_id FROM unit_status_history WHERE unit_id = $1 ORDER BY id DESC LIMIT 1', [emp.u101])).rows[0];
    expect(hist).toEqual({ para: 'vendido', motivo: 'CRM: contrato assinado', user_id: null });

    // repetir é seguro; depois, só pelo código do CRM (e o preço junto)
    expect((await req('POST', '/v1/unidades/status', { unidades: [{ id: emp.u101, crmId: 'CRM-101', status: 'vendido' }] }, chave)).json).toMatchObject({ atualizadas: 0, semMudanca: 1 });
    const porCrm = await req('POST', '/v1/unidades/status', { unidades: [{ crmId: 'CRM-101', status: 'disponivel', preco: 640000 }, { crmId: 'NAO-EXISTE', status: 'vendido' }] }, chave);
    expect(porCrm.json).toMatchObject({ atualizadas: 1, naoEncontradas: 1 });
    const u = (await req('GET', `/v1/unidades?predioId=${emp.torreA}`, undefined, chave)).json.find((x: { id: string }) => x.id === emp.u101);
    expect(u).toMatchObject({ crmId: 'CRM-101', status: 'disponivel', preco: 640000 });

    // isolamento e entrada
    expect((await req('POST', '/v1/unidades/status', { unidades: [{ id: emp.u101, status: 'vendido' }] }, daOutra)).json).toMatchObject({ atualizadas: 0, naoEncontradas: 1 });
    expect((await req('POST', '/v1/unidades/status', { unidades: [{ status: 'vendido' }] }, chave)).status).toBe(400);
    expect((await req('POST', '/v1/unidades/status', { unidades: [{ id: emp.u101, status: 'demolido' }] }, chave)).status).toBe(400);
    expect((await req('POST', '/v1/unidades/status', { unidades: [{ id: emp.u101, status: 'vendido' }] }, gestao)).status).toBe(401);
  });
});
