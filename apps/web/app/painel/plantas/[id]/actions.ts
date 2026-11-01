'use server';
import { revalidatePath } from 'next/cache';
import type { EdicaoPlanta } from '@imersa/viewer';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';

export async function salvarEdicao(plantaId: string, edicao: EdicaoPlanta): Promise<{ erro?: string }> {
  const r = await api(`/plantas/${encodeURIComponent(plantaId)}/edicao`, { metodo: 'PUT', corpo: edicao, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/plantas/${plantaId}`);
  return {};
}

/** 3D já enviado e verificado → fica ligado à planta e vira o modelo do prédio escolhido. */
export async function usarModelo(plantaId: string, projetoId: string, arquivoId: string, predioId: string | null): Promise<{ erro?: string }> {
  const r = await api(`/plantas/${encodeURIComponent(plantaId)}/modelo`, { metodo: 'POST', corpo: { arquivoId, predioId }, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/projetos/${projetoId}`);
  if (predioId) revalidatePath(`/painel/predios/${predioId}`);
  return {};
}
