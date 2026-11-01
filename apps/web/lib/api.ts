import 'server-only';
import { headers } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3333';

export interface RespostaApi<T> {
  status: number;
  dados: T;
}

/** Chamada servidor→API. Repassa o IP e o navegador de quem pediu (limite por pessoa e registro do consentimento LGPD). */
export async function api<T = unknown>(
  caminho: string,
  opcoes: { metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; corpo?: unknown; token?: string } = {},
): Promise<RespostaApi<T>> {
  const h = await headers();
  const ip = h.get('x-forwarded-for') ?? h.get('x-real-ip');
  const navegador = h.get('user-agent');
  const r = await fetch(`${API_URL}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      ...(opcoes.corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
      ...(navegador ? { 'user-agent': navegador } : {}),
    },
    body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
    cache: 'no-store',
  });
  const texto = await r.text();
  return { status: r.status, dados: (texto ? JSON.parse(texto) : {}) as T };
}

/** Como `api`, mas devolve a resposta sem ler o corpo: para repassar um fluxo (SSE) ao navegador. */
/** GET cru (arquivo para baixar): a resposta da API passa direto, sem ler o corpo aqui. */
export async function apiArquivo(caminho: string, token: string): Promise<Response> {
  return fetch(`${API_URL}${caminho}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
}

export async function apiFluxo(caminho: string, opcoes: { corpo: string; token: string }): Promise<Response> {
  const h = await headers();
  const ip = h.get('x-forwarded-for') ?? h.get('x-real-ip');
  const navegador = h.get('user-agent');
  return fetch(`${API_URL}${caminho}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opcoes.token}`,
      ...(ip ? { 'x-forwarded-for': ip } : {}),
      ...(navegador ? { 'user-agent': navegador } : {}),
    },
    body: opcoes.corpo,
    cache: 'no-store',
  });
}
