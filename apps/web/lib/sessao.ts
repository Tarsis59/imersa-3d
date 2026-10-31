import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, type RespostaApi } from './api';
import { COOKIE_ACESSO, COOKIE_REFRESH } from './cookies';

const BASE = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };

export interface Tokens {
  acesso: string;
  refresh: string;
}

export async function salvarSessao(t: Tokens): Promise<void> {
  const c = await cookies();
  c.set(COOKIE_ACESSO, t.acesso, { ...BASE, maxAge: 15 * 60 });
  c.set(COOKIE_REFRESH, t.refresh, { ...BASE, maxAge: 30 * 24 * 3600 });
}

export async function lerSessao(): Promise<Partial<Tokens>> {
  const c = await cookies();
  return { acesso: c.get(COOKIE_ACESSO)?.value, refresh: c.get(COOKIE_REFRESH)?.value };
}

export async function limparSessao(): Promise<void> {
  const c = await cookies();
  c.delete(COOKIE_ACESSO);
  c.delete(COOKIE_REFRESH);
}

const renovar = (volta: string) => `/api/renovar?volta=${encodeURIComponent(volta)}`;

/** Para Server Components (não podem gravar cookie): sem acesso válido → passa pela rota que renova. */
export async function apiNaPagina<T>(caminho: string, volta: string): Promise<RespostaApi<T>> {
  const { acesso, refresh } = await lerSessao();
  if (!acesso) redirect(refresh ? renovar(volta) : '/login');
  const r = await api<T>(caminho, { token: acesso });
  if (r.status === 401) redirect(refresh ? renovar(volta) : '/login');
  return r;
}

/** Para Server Actions (podem gravar cookie): renova na hora se preciso. */
export async function tokenParaAcao(): Promise<string> {
  const { acesso, refresh } = await lerSessao();
  if (acesso) return acesso;
  if (refresh) {
    const r = await api<Tokens>('/auth/refresh', { metodo: 'POST', corpo: { refresh } });
    if (r.status === 200) {
      await salvarSessao(r.dados);
      return r.dados.acesso;
    }
  }
  redirect('/login');
}
