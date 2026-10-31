import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { IdParam } from '../esquemas';
import { transmitirPredio, type CanalUnidades } from '../tempo-real/canal';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
  canal: CanalUnidades;
  segredo: string;
  /** Endereço da API visto pelo navegador (o EventSource conecta direto, sem passar pelo site). */
  apiPublica: string;
}

// Público próprio: o bilhete nunca serve como token de acesso (e vice-versa).
const PUBLICO = 'imersa-ao-vivo';
const VALIDADE_S = 120;
const Bilhete = z.object({ ticket: z.string().min(20).max(2000) });
const Carga = z.object({ tid: z.uuid(), pid: z.uuid() });
const chave = (s: string) => new TextEncoder().encode(s);

export function rotasAoVivo(app: FastifyInstance, { pool, exigir, canal, segredo, apiPublica }: Dependencias): void {
  /**
   * O EventSource do navegador não manda cabeçalho Authorization: o site pede aqui um bilhete curto, preso a um prédio,
   * e abre `/ao-vivo?ticket=…`. O bilhete só é conferido ao conectar; a transmissão segue enquanto a página estiver aberta.
   */
  app.post('/predios/:id/ao-vivo', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    await withTenant(pool, { tenantId: s.tenantId, userId: s.userId }, async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
    });
    const agora = Math.floor(Date.now() / 1000);
    const ticket = await new SignJWT({ tid: s.tenantId, pid: id })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(s.userId)
      .setAudience(PUBLICO)
      .setIssuedAt(agora)
      .setExpirationTime(agora + VALIDADE_S)
      .sign(chave(segredo));
    return { url: `${apiPublica}/ao-vivo?ticket=${ticket}` };
  });

  app.get('/ao-vivo', async (req, reply) => {
    const { ticket } = Bilhete.parse(req.query);
    let carga: z.infer<typeof Carga>;
    try {
      carga = Carga.parse((await jwtVerify(ticket, chave(segredo), { audience: PUBLICO, algorithms: ['HS256'] })).payload);
    } catch {
      throw new ErroHttp(401, 'bilhete_invalido');
    }
    await transmitirPredio(req, reply, canal, { tenantId: carga.tid, predioId: carga.pid });
  });
}
