import 'server-only';
import { headers } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3333';

export interface RespostaApi<T> {
  status: number;
  dados: T;
}

/** Chamada servidor→API. Repassa o IP do navegador para o limite de tentativas por pessoa. */
export async function api<T = unknown>(
  caminho: string,
  opcoes: { metodo?: 'GET' | 'POST'; corpo?: unknown; token?: string } = {},
): Promise<RespostaApi<T>> {
  const h = await headers();
  const ip = h.get('x-forwarded-for') ?? h.get('x-real-ip');
  const r = await fetch(`${API_URL}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      ...(opcoes.corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
    cache: 'no-store',
  });
  const texto = await r.text();
  return { status: r.status, dados: (texto ? JSON.parse(texto) : {}) as T };
}
