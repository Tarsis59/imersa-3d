import type { FastifyReply, FastifyRequest } from 'fastify';
import pg from 'pg';

export interface MudancaUnidade {
  unidadeId: string;
  status: string;
}
interface Alvo {
  tenantId: string;
  predioId: string;
}
/** Câmera da consultora no tour guiado ao vivo (repassada só a quem assiste o mesmo link). */
export interface Conducao {
  ativo: boolean;
  posicao?: [number, number, number];
  alvo?: [number, number, number];
  unidade?: string | null;
}
interface Ouvinte extends Alvo {
  /** Link do portal de quem assiste: recebe a condução da consultora nesse link. */
  linkId?: string;
  aoMudar: (m: MudancaUnidade) => void;
  aoConduzir?: (c: Conducao) => void;
  aoFechar: () => void;
}

const CANAL = 'imersa_unidades';
export const CANAL_CONDUCAO = 'imersa_conducao';
const PULSO_MS = 25_000;

/**
 * Status de unidade ao vivo: UMA conexão LISTEN no Postgres por instância da API, repassada a quem assiste cada prédio.
 * O aviso vem do gatilho `units_status_ao_vivo` (migration 009), então nenhuma rota esquece de avisar.
 */
export class CanalUnidades {
  private cliente: pg.Client | null = null;
  private conectando: Promise<void> | null = null;
  private readonly ouvintes = new Set<Ouvinte>();
  private fechado = false;

  constructor(private readonly url: string) {}

  /** Começa a ouvir o prédio. Devolve a função que para de ouvir. */
  async assinar(o: Ouvinte): Promise<() => void> {
    await this.conectar();
    this.ouvintes.add(o);
    return () => this.ouvintes.delete(o);
  }

  get assinantes(): number {
    return this.ouvintes.size;
  }

  private conectar(): Promise<void> {
    if (this.cliente) return Promise.resolve();
    this.conectando ??= (async () => {
      const c = new pg.Client({ connectionString: this.url });
      c.on('notification', (n) => (n.channel === CANAL_CONDUCAO ? this.repassarConducao(n.payload) : this.repassar(n.payload)));
      // caiu (banco reiniciou, rede): reconecta enquanto houver alguém assistindo
      const perdeu = () => {
        if (this.cliente !== c) return;
        this.cliente = null;
        if (!this.fechado && this.ouvintes.size) setTimeout(() => void this.conectar().catch(() => undefined), 1000);
      };
      c.on('error', perdeu);
      c.on('end', perdeu);
      await c.connect();
      await c.query(`LISTEN ${CANAL}`);
      await c.query(`LISTEN ${CANAL_CONDUCAO}`);
      this.cliente = c;
    })().finally(() => (this.conectando = null));
    return this.conectando;
  }

  private repassar(payload: string | undefined): void {
    let m: { t: string; b: string; u: string; s: string };
    try {
      m = JSON.parse(payload ?? '');
    } catch {
      return;
    }
    // a empresa também confere: um prédio nunca recebe aviso de outra empresa
    for (const o of this.ouvintes) if (o.predioId === m.b && o.tenantId === m.t) o.aoMudar({ unidadeId: m.u, status: m.s });
  }

  private repassarConducao(payload: string | undefined): void {
    let m: { t: string; l: string } & Conducao;
    try {
      m = JSON.parse(payload ?? '');
    } catch {
      return;
    }
    const { t: tenant, l: link, ...conducao } = m;
    for (const o of this.ouvintes) if (o.linkId === link && o.tenantId === tenant) o.aoConduzir?.(conducao);
  }

  async fechar(): Promise<void> {
    this.fechado = true;
    for (const o of this.ouvintes) o.aoFechar();
    this.ouvintes.clear();
    const c = this.cliente;
    this.cliente = null;
    await c?.end().catch(() => undefined);
  }
}

/**
 * Transmissão SSE (EventSource) das mudanças do prédio. Cabeçalhos de CORS/segurança já postos pelos plugins são mantidos.
 * `: conectado` só sai depois de assinar o canal: quem recebe sabe que nenhuma mudança se perde dali em diante.
 */
export async function transmitirPredio(req: FastifyRequest, reply: FastifyReply, canal: CanalUnidades, alvo: Alvo & { linkId?: string }): Promise<void> {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  let sair: (() => void) | null = null;
  let pulso: NodeJS.Timeout | undefined;
  const encerrar = () => {
    clearInterval(pulso);
    sair?.();
    if (!res.writableEnded) res.end();
  };
  req.raw.on('close', encerrar);
  try {
    sair = await canal.assinar({
      ...alvo,
      aoMudar: (m) => res.write(`event: unidade\ndata: ${JSON.stringify({ id: m.unidadeId, status: m.status })}\n\n`),
      aoConduzir: (c) => res.write(`event: conducao\ndata: ${JSON.stringify(c)}\n\n`),
      aoFechar: encerrar,
    });
  } catch {
    res.end('event: erro\ndata: {}\n\n');
    return;
  }
  // saiu enquanto assinava: não deixa ouvinte pendurado
  if (res.writableEnded) return sair();
  res.write('retry: 3000\n: conectado\n\n');
  pulso = setInterval(() => res.write(': pulso\n\n'), PULSO_MS);
}
