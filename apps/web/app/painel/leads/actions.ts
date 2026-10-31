'use server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';
import type { StatusLead } from '@/lib/tipos';

export async function mudarStatusLead(leadId: string, status: StatusLead): Promise<{ erro?: string }> {
  const r = await api(`/leads/${encodeURIComponent(leadId)}`, { metodo: 'PATCH', corpo: { status }, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath('/painel/leads');
  return {};
}
