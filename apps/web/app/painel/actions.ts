'use server';
import QRCode from 'qrcode';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { salvarSessao, tokenParaAcao, type Tokens } from '@/lib/sessao';

export interface EstadoForm {
  erro?: string;
  ok?: string;
}

export async function criarProjeto(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const token = await tokenParaAcao();
  const r = await api('/projetos', { metodo: 'POST', corpo: { nome: String(form.get('nome') ?? '') }, token });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath('/painel');
  return { ok: 'Projeto criado.' };
}

export interface EstadoConvite extends EstadoForm {
  link?: string;
}

export async function convidar(_: EstadoConvite, form: FormData): Promise<EstadoConvite> {
  const token = await tokenParaAcao();
  const r = await api<{ link: string }>('/membros/convites', {
    metodo: 'POST',
    corpo: { email: String(form.get('email') ?? ''), papel: String(form.get('papel') ?? '') },
    token,
  });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath('/painel/membros');
  return { ok: 'Convite criado. Envie o link abaixo para a pessoa (vale 7 dias, uso único).', link: r.dados.link };
}

export interface EstadoMfa extends EstadoForm {
  segredo?: string;
  qr?: string;
}

export async function gerarMfa(): Promise<EstadoMfa> {
  const token = await tokenParaAcao();
  const r = await api<{ segredo: string; otpauth: string }>('/auth/mfa/ativar', { metodo: 'POST', corpo: {}, token });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  return { segredo: r.dados.segredo, qr: await QRCode.toDataURL(r.dados.otpauth, { margin: 1, width: 220 }) };
}

export async function confirmarMfa(_: EstadoForm, form: FormData): Promise<EstadoForm> {
  const token = await tokenParaAcao();
  const r = await api<Tokens>('/auth/mfa/confirmar', { metodo: 'POST', corpo: { codigo: String(form.get('codigo') ?? '') }, token });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  await salvarSessao(r.dados);
  redirect('/painel');
}
