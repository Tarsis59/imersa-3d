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

export interface EstadoModelo {
  erro?: string;
  ok?: string;
}

export async function vincularModelo(predioId: string, _: EstadoModelo, form: FormData): Promise<EstadoModelo> {
  const arquivoId = String(form.get('arquivoId') ?? '') || null;
  const r = await api(`/predios/${predioId}/modelo`, { metodo: 'PATCH', corpo: { arquivoId }, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}`);
  return { ok: arquivoId ? 'Modelo 3D ligado ao prédio.' : 'Modelo 3D desligado do prédio.' };
}

/** Liga (ou desliga, com meshNodeId null) uma peça do modelo 3D a uma unidade. */
export async function vincularPeca(predioId: string, unidadeId: string, meshNodeId: string | null): Promise<{ erro?: string }> {
  const r = await api(`/unidades/${encodeURIComponent(unidadeId)}`, { metodo: 'PATCH', corpo: { meshNodeId }, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}/3d`);
  revalidatePath(`/painel/predios/${predioId}`);
  return {};
}

/** Link novo para o cliente. O endereço completo só aparece agora (o banco guarda só o hash do token). */
export async function criarLink(predioId: string, titulo: string, dias: number): Promise<{ url: string; expiraEm: string } | { erro: string }> {
  const r = await api<{ url: string; expiraEm: string }>(`/predios/${encodeURIComponent(predioId)}/links`, {
    metodo: 'POST',
    corpo: { ...(titulo.trim() ? { titulo: titulo.trim() } : {}), dias },
    token: await tokenParaAcao(),
  });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}`);
  return r.dados;
}

export async function revogarLink(predioId: string, linkId: string): Promise<{ erro?: string }> {
  const r = await api(`/links/${encodeURIComponent(linkId)}/revogar`, { metodo: 'POST', corpo: {}, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}`);
  return {};
}

/** Pede o giro 360° fotorrealista do modelo atual (render no Blender, na GPU gratuita do Kaggle). */
export async function pedirGiro(predioId: string): Promise<{ erro?: string }> {
  const r = await api(`/predios/${encodeURIComponent(predioId)}/giros`, { metodo: 'POST', corpo: {}, token: await tokenParaAcao() });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}`);
  return {};
}
