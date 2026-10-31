'use server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';

export interface EstadoStatus {
  erro?: string;
  ok?: string;
  /** Unidade a que a mensagem se refere (para não mostrar o aviso em outra unidade selecionada). */
  unidadeId?: string;
}

export async function mudarStatus(predioId: string, _: EstadoStatus, form: FormData): Promise<EstadoStatus> {
  const unidadeId = String(form.get('unidadeId') ?? '');
  const status = String(form.get('status') ?? '');
  const motivo = String(form.get('motivo') ?? '').trim();
  const r = await api(`/unidades/${encodeURIComponent(unidadeId)}/status`, {
    metodo: 'POST',
    corpo: { status, ...(motivo ? { motivo } : {}) },
    token: await tokenParaAcao(),
  });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados), unidadeId };
  revalidatePath(`/painel/predios/${predioId}`);
  return { ok: 'Status alterado.', unidadeId };
}
