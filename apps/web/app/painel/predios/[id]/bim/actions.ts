'use server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';

export async function salvarVinculos(
  predioId: string,
  conversaoId: string,
  vinculos: Array<{ unidadeId: string; espacoGuid: string | null }>,
): Promise<{ erro?: string; vinculadas?: number }> {
  const r = await api<{ vinculadas: number }>(`/predios/${encodeURIComponent(predioId)}/vinculos-bim`, { metodo: 'POST', corpo: { conversaoId, vinculos }, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}`);
  return { vinculadas: r.dados.vinculadas };
}
