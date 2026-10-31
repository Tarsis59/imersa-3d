import type pg from 'pg';
import { withTenant } from '@imersa/db';
import { decifrar } from '../cripto';
import { assinar, destinoPermitido, proximaTentativaS } from './assinatura';

interface Opcoes {
  /** Só desenvolvimento/testes: aceita webhook na rede local. */
  permitirLocal?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
  lote?: number;
}

interface Entrega {
  id: string;
  tenant_id: string;
  url: string;
  segredo_cifrado: string;
  evento: string;
  payload: unknown;
  tentativas: number;
  criado_em: Date;
}

/**
 * Entrega os webhooks vencidos (de todas as empresas). Sucesso = resposta 2xx; senão, nova tentativa com espera
 * exponencial (30 s, 1 min, 2 min… até 6 h) e, depois de 8 tentativas, desiste. Devolve quantas tentou.
 */
export async function entregarWebhooks(pool: pg.Pool, chaveCifra: string, opcoes: Opcoes = {}): Promise<number> {
  const enviar = opcoes.fetch ?? fetch;
  const entregas = (await pool.query<Entrega>('SELECT * FROM pegar_entregas_webhook($1)', [opcoes.lote ?? 20])).rows;
  await Promise.all(
    entregas.map(async (e) => {
      const corpo = JSON.stringify({ id: e.id, evento: e.evento, criadoEm: e.criado_em, dados: e.payload });
      let resultado: { ok: boolean; status: number | null; erro: string | null; desistir?: boolean };
      if (!(await destinoPermitido(e.url, { permitirLocal: opcoes.permitirLocal }))) {
        // endereço passou a apontar para rede interna (ou nunca foi válido): não insiste
        resultado = { ok: false, status: null, erro: 'destino bloqueado (rede interna ou sem https)', desistir: true };
      } else {
        try {
          const r = await enviar(e.url, {
            method: 'POST',
            body: corpo,
            redirect: 'manual', // não segue redirecionamento (poderia levar para a rede interna)
            signal: AbortSignal.timeout(opcoes.timeoutMs ?? 10_000),
            headers: {
              'content-type': 'application/json',
              'user-agent': 'Imersa3D-Webhooks/1.0',
              'x-imersa-evento': e.evento,
              'x-imersa-entrega': e.id,
              'x-imersa-assinatura': assinar(decifrar(e.segredo_cifrado, chaveCifra), corpo),
            },
          });
          await r.body?.cancel().catch(() => undefined);
          resultado = { ok: r.status >= 200 && r.status < 300, status: r.status, erro: r.status >= 200 && r.status < 300 ? null : `resposta ${r.status}` };
        } catch (erro) {
          resultado = { ok: false, status: null, erro: (erro as Error).name === 'TimeoutError' ? 'sem resposta em 10 s' : String((erro as Error).message).slice(0, 300) };
        }
      }
      const espera = resultado.desistir ? null : proximaTentativaS(e.tentativas);
      await withTenant(pool, { tenantId: e.tenant_id, userId: null }, (c) =>
        resultado.ok
          ? c.query("UPDATE webhook_entregas SET status = 'entregue', entregue_em = now(), ultimo_status = $2, ultimo_erro = NULL WHERE id = $1", [e.id, resultado.status])
          : c.query(
              `UPDATE webhook_entregas SET ultimo_status = $2, ultimo_erro = $3,
                      status = CASE WHEN $4::int IS NULL THEN 'falhou' ELSE 'pendente' END,
                      proxima_em = CASE WHEN $4::int IS NULL THEN proxima_em ELSE now() + make_interval(secs => $4) END
                WHERE id = $1`,
              [e.id, resultado.status, resultado.erro, espera],
            ),
      );
    }),
  );
  return entregas.length;
}
