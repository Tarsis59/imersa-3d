'use server';
import { api } from '@/lib/api';
import { tokenParaAcao } from '@/lib/sessao';
import type { Arquivo, FonteMarca } from '@/lib/tipos';

export type MarcaBruta = { logoAssetId: string | null; corPrimaria: string | null; fonte: FonteMarca };

/** Marca atual da empresa (Plano 12b, item 11). */
export async function buscarMarca(): Promise<MarcaBruta | null> {
  const r = await api<MarcaBruta>('/empresa/marca', { token: await tokenParaAcao() });
  return r.status === 200 ? r.dados : null;
}

const ERROS_MARCA: Record<number, string> = {
  400: 'Confira a cor (#RRGGBB) e o arquivo escolhido como logo.',
  403: 'Só a gestão (com verificação em duas etapas) edita a marca.',
};

export async function salvarMarca(d: Partial<MarcaBruta>): Promise<{ erro?: string }> {
  const r = await api('/empresa/marca', { metodo: 'PATCH', corpo: d, token: await tokenParaAcao() });
  return r.status === 200 ? {} : { erro: ERROS_MARCA[r.status] ?? 'Não foi possível salvar a marca agora.' };
}

/** Fotos prontas de um projeto, para escolher o arquivo do logo (ele já precisa estar enviado em algum projeto). */
export async function fotosDoProjetoEscolhido(projetoId: string): Promise<Array<{ id: string; nome: string }>> {
  const r = await api<Arquivo[]>(`/projetos/${encodeURIComponent(projetoId)}/arquivos`, { token: await tokenParaAcao() });
  if (r.status !== 200) return [];
  return r.dados.filter((a) => a.tipo === 'imagem' && a.status === 'pronto').map((a) => ({ id: a.id, nome: a.nome }));
}
