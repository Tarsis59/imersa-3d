import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import pg from 'pg';

/**
 * Visita em grupo (Plano 11d, item 18): quem abre o mesmo link entra na mesma "sala". O servidor só repassa sinais:
 * presença (entrou, saiu), a posição de cada boneco e a combinação da chamada de voz (WebRTC: oferta, resposta e
 * candidatos ICE). A voz vai direto entre os aparelhos; nada de áudio passa pelo servidor nem é gravado.
 * Um LISTEN por instância da API (canal `imersa_sala` do Postgres), como o status ao vivo.
 */
export const CANAL_SALA = 'imersa_sala';
export const MAX_NA_SALA = 6;
const PULSO_MS = 25_000;
/** O NOTIFY do Postgres aceita até ~8 KB por mensagem (uma oferta de áudio cabe com folga). */
export const MAX_SINAL_BYTES = 7000;

export type TipoSinal = 'entrou' | 'saiu' | 'posicao' | 'oferta' | 'resposta' | 'ice';
export interface Sinal {
  /** empresa e link: a sala */
  t: string;
  l: string;
  de: string;
  /** null = para todos da sala */
  para: string | null;
  tipo: TipoSinal;
  dados: unknown;
}

/** Quem recebe: mesma sala, nunca o próprio remetente; com destinatário, só ele. */
export const entrega = (s: Sinal, ouvinte: { t: string; l: string; id: string }): boolean =>
  s.t === ouvinte.t && s.l === ouvinte.l && s.de !== ouvinte.id && (s.para === null || s.para === ouvinte.id);

interface Ouvinte {
  t: string;
  l: string;
  id: string;
  nome: string;
  receber: (s: Sinal) => void;
}

export class CanalSala {
  private cliente: pg.Client | null = null;
  private conectando: Promise<void> | null = null;
  private readonly ouvintes = new Set<Ouvinte>();

  constructor(
    private readonly url: string,
    private readonly pool: pg.Pool,
  ) {}

  /** Quantos estão na sala nesta instância (limite por sala). */
  naSala(t: string, l: string): number {
    let n = 0;
    for (const o of this.ouvintes) if (o.t === t && o.l === l) n++;
    return n;
  }

  async enviar(s: Sinal): Promise<void> {
    const carga = JSON.stringify(s);
    if (Buffer.byteLength(carga) > MAX_SINAL_BYTES) throw new Error('sinal grande demais');
    await this.pool.query('SELECT pg_notify($1, $2)', [CANAL_SALA, carga]);
  }

  async entrar(o: Ouvinte): Promise<() => Promise<void>> {
    await this.conectar();
    this.ouvintes.add(o);
    await this.enviar({ t: o.t, l: o.l, de: o.id, para: null, tipo: 'entrou', dados: { nome: o.nome } });
    return async () => {
      if (!this.ouvintes.delete(o)) return;
      await this.enviar({ t: o.t, l: o.l, de: o.id, para: null, tipo: 'saiu', dados: {} }).catch(() => undefined);
    };
  }

  private conectar(): Promise<void> {
    if (this.cliente) return Promise.resolve();
    this.conectando ??= (async () => {
      const c = new pg.Client({ connectionString: this.url });
      c.on('notification', (n) => {
        let s: Sinal;
        try {
          s = JSON.parse(n.payload ?? '') as Sinal;
        } catch {
          return;
        }
        for (const o of this.ouvintes) if (entrega(s, o)) o.receber(s);
      });
      const perdeu = () => {
        if (this.cliente === c) this.cliente = null;
      };
      c.on('error', perdeu);
      c.on('end', perdeu);
      await c.connect();
      await c.query(`LISTEN ${CANAL_SALA}`);
      this.cliente = c;
    })().finally(() => (this.conectando = null));
    return this.conectando;
  }

  async fechar(): Promise<void> {
    this.ouvintes.clear();
    await this.cliente?.end().catch(() => undefined);
    this.cliente = null;
  }
}

/** SSE da sala: primeiro "eu" (o id desta pessoa), depois os sinais dos outros. */
export async function transmitirSala(req: FastifyRequest, reply: FastifyReply, canal: CanalSala, sala: { t: string; l: string; nome: string }): Promise<void> {
  if (canal.naSala(sala.t, sala.l) >= MAX_NA_SALA) {
    await reply.status(409).send({ erro: 'sala_cheia' });
    return;
  }
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const id = randomUUID();
  let sair: (() => Promise<void>) | null = null;
  let pulso: NodeJS.Timeout | undefined;
  const encerrar = () => {
    clearInterval(pulso);
    void sair?.();
    if (!res.writableEnded) res.end();
  };
  req.raw.on('close', encerrar);
  res.write(`retry: 3000\nevent: eu\ndata: ${JSON.stringify({ id })}\n\n`);
  try {
    sair = await canal.entrar({ ...sala, id, receber: (s) => res.write(`event: ${s.tipo}\ndata: ${JSON.stringify({ de: s.de, dados: s.dados })}\n\n`) });
  } catch {
    res.end('event: erro\ndata: {}\n\n');
    return;
  }
  if (res.writableEnded) return void sair();
  pulso = setInterval(() => res.write(': pulso\n\n'), PULSO_MS);
}
