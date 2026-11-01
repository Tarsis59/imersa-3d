import Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { IdParam } from '../esquemas';
import { conferirLimite, conversar, type ChamarModelo } from '../ia/assistente';
import type { ContextoIA } from '../ia/ferramentas';

/** Assistente ligado (há chave da API do Claude) e com o quê. */
export interface ConfigIA {
  chamar: ChamarModelo | null;
  modelo: string;
  limiteTokensMes: number;
}

export const Pergunta = z.object({
  mensagens: z
    .array(z.object({ papel: z.enum(['cliente', 'assistente']), texto: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20),
});

/**
 * Responde em SSE: `texto` (pedaço da resposta), `acao` (destacar unidades, voar, abrir o contato), `substituir`
 * (a guarda trocou a resposta), `fim` e `erro`. Limite e entrada são conferidos ANTES de abrir o fluxo (erro normal).
 */
export async function responderAssistente(
  req: FastifyRequest,
  reply: FastifyReply,
  o: { ia: ConfigIA; pool: pg.Pool; tenantId: string; contexto: ContextoIA },
): Promise<void> {
  if (!o.ia.chamar) throw new ErroHttp(503, 'ia_indisponivel');
  const { mensagens } = Pergunta.parse(req.body);
  await withTenant(o.pool, { tenantId: o.tenantId, userId: null }, (c) => conferirLimite(c, o.ia.limiteTokensMes));
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const enviar = (evento: string, dados: unknown) => {
    if (!res.writableEnded) res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
  };
  try {
    const fim = await conversar({
      chamar: o.ia.chamar,
      pool: o.pool,
      tenantId: o.tenantId,
      contexto: o.contexto,
      historico: mensagens,
      modelo: o.ia.modelo,
      limiteTokensMes: o.ia.limiteTokensMes,
      aoTexto: (t) => enviar('texto', { t }),
      aoAcao: (a) => enviar('acao', a),
    });
    if (fim.substituida) enviar('substituir', { texto: fim.texto });
    enviar('fim', { texto: fim.texto });
  } catch (e) {
    // a mensagem do provedor pode trazer detalhes da conta: o cliente só recebe um código
    const codigo =
      e instanceof ErroHttp ? e.codigo : e instanceof Anthropic.RateLimitError ? 'ia_ocupada' : e instanceof Anthropic.APIError ? 'ia_falhou' : 'erro_inesperado';
    req.log?.error({ err: e }, 'assistente falhou');
    enviar('erro', { codigo });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
  ia: ConfigIA;
}

/** No painel (Vitrine): a consultora testa o assistente no prédio que está mostrando. */
export function rotasAssistente(app: FastifyInstance, { pool, exigir, ia }: Dependencias): void {
  /** Assistente ligado nesta instalação (há chave da API do Claude)? A Vitrine do painel só mostra o chat se sim. */
  app.get('/ia', async (req) => {
    await exigir(req, 'projeto:ler');
    return { ligada: ia.chamar !== null };
  });

  app.post('/predios/:id/assistente', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } }, bodyLimit: 64 * 1024 }, async (req, reply) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    const p = await withTenant(pool, { tenantId: s.tenantId, userId: s.userId }, async (c) => (await c.query<{ project_id: string }>('SELECT project_id FROM buildings WHERE id = $1', [id])).rows[0]);
    if (!p) throw new ErroHttp(404, 'nao_encontrado');
    await responderAssistente(req, reply, { ia, pool, tenantId: s.tenantId, contexto: { predioId: id, projetoId: p.project_id } });
  });
}
