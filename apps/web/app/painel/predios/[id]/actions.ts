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
export async function criarLink(predioId: string, titulo: string, dias: number, whatsapp = ''): Promise<{ url: string; expiraEm: string } | { erro: string }> {
  const r = await api<{ url: string; expiraEm: string }>(`/predios/${encodeURIComponent(predioId)}/links`, {
    metodo: 'POST',
    corpo: { ...(titulo.trim() ? { titulo: titulo.trim() } : {}), dias, ...(whatsapp.trim() ? { whatsapp: whatsapp.trim() } : {}) },
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

/** Pede um vídeo de marketing do prédio no formato escolhido (render no Blender, na GPU gratuita do Kaggle). */
export async function pedirVideo(
  predioId: string,
  formato: '9:16' | '1:1' | '16:9',
  narracao: { voz: 'pf_dora' | 'pm_alex'; texto?: string } | null = null,
): Promise<{ erro?: string }> {
  const corpo = narracao ? { formato, narracao: { voz: narracao.voz, ...(narracao.texto?.trim() ? { texto: narracao.texto.trim() } : {}) } } : { formato };
  const r = await api(`/predios/${encodeURIComponent(predioId)}/videos`, { metodo: 'POST', corpo, token: await tokenParaAcao() });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}`);
  return {};
}

/** Estande novo: devolve o endereço para abrir no PC do estande (só aparece agora). */
export async function criarEstande(predioId: string, nome: string): Promise<{ url?: string; erro?: string }> {
  const r = await api<{ url: string }>(`/predios/${encodeURIComponent(predioId)}/estandes`, { metodo: 'POST', corpo: { nome }, token: await tokenParaAcao() });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}`);
  return { url: r.dados.url };
}

export async function comandarEstande(predioId: string, estandeId: string, comando: 'recarregar' | 'desativar'): Promise<{ erro?: string }> {
  const r = await api(`/estandes/${encodeURIComponent(estandeId)}/${comando}`, { metodo: 'POST', corpo: {}, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}`);
  return {};
}

/** Editar e pedir por texto (Plano 11e): prévia sem gravar; `aplicar` só depois da confirmação. */
export async function comandoGestao(predioId: string, texto: string, aplicar: boolean): Promise<import('./pedir-por-texto').RespostaComando> {
  const r = await api<import('./pedir-por-texto').RespostaComando>(`/predios/${encodeURIComponent(predioId)}/comandos`, { metodo: 'POST', corpo: { texto, aplicar }, token: await tokenParaAcao() });
  if (r.status !== 200) return { aplicado: false, mudancas: [], avisos: [], acoes: [], erro: mensagem(r.status, r.dados) };
  if (aplicar) revalidatePath(`/painel/predios/${predioId}`);
  return r.dados;
}
