'use server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';

type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: string };
const pronto = () => revalidatePath('/painel/integracoes');

export async function criarChave(nome: string): Promise<Resultado<{ chave: string }>> {
  const r = await api<{ chave: string }>('/integracoes/chaves', { metodo: 'POST', corpo: { nome }, token: await tokenParaAcao() });
  if (r.status !== 201) return { ok: false, erro: mensagem(r.status, r.dados) };
  pronto();
  return { ok: true, chave: r.dados.chave };
}

export async function revogarChave(id: string): Promise<Resultado<object>> {
  const r = await api(`/integracoes/chaves/${encodeURIComponent(id)}/revogar`, { metodo: 'POST', corpo: {}, token: await tokenParaAcao() });
  if (r.status !== 200) return { ok: false, erro: mensagem(r.status, r.dados) };
  pronto();
  return { ok: true };
}

export async function criarWebhook(url: string, eventos: string[]): Promise<Resultado<{ segredo: string }>> {
  const r = await api<{ segredo: string }>('/integracoes/webhooks', { metodo: 'POST', corpo: { url, eventos }, token: await tokenParaAcao() });
  if (r.status !== 201) return { ok: false, erro: mensagem(r.status, r.dados) };
  pronto();
  return { ok: true, segredo: r.dados.segredo };
}

export async function apagarWebhook(id: string): Promise<Resultado<object>> {
  const r = await api(`/integracoes/webhooks/${encodeURIComponent(id)}`, { metodo: 'DELETE', token: await tokenParaAcao() });
  if (r.status !== 204) return { ok: false, erro: mensagem(r.status, r.dados) };
  pronto();
  return { ok: true };
}

export async function testarWebhook(id: string): Promise<Resultado<object>> {
  const r = await api(`/integracoes/webhooks/${encodeURIComponent(id)}/testar`, { metodo: 'POST', corpo: {}, token: await tokenParaAcao() });
  if (r.status !== 202) return { ok: false, erro: mensagem(r.status, r.dados) };
  pronto();
  return { ok: true };
}
