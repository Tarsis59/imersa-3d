'use server';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';

export interface EstadoAceite {
  erro?: string;
}

export async function aceitarConvite(_: EstadoAceite, form: FormData): Promise<EstadoAceite> {
  const nome = String(form.get('nome') ?? '').trim();
  const r = await api<{ empresa: string }>('/convites/aceitar', {
    metodo: 'POST',
    corpo: { token: String(form.get('token') ?? ''), senha: String(form.get('senha') ?? ''), ...(nome ? { nome } : {}) },
  });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  redirect(`/login?empresa=${encodeURIComponent(r.dados.empresa)}`);
}
