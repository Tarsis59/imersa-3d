'use server';
import type { Entorno } from '@imersa/viewer';
import { api } from '@/lib/api';
import { tokenParaAcao } from '@/lib/sessao';
import type { CategoriaLazer, ItemLazer } from '@/lib/tipos';

export type ResultadoEntorno = { entorno: Entorno } | { entorno: null; motivo: 'sem_localizacao' | 'indisponivel' };

/** Prédios reais em volta do empreendimento. Carregado depois do prédio, para a primeira imagem não esperar o OSM. */
export async function carregarEntorno(projetoId: string): Promise<ResultadoEntorno> {
  const r = await api<{ semLocalizacao: boolean; centro: Entorno['centro'] | null; predios: Entorno['predios']; atribuicao: string }>(
    `/projetos/${encodeURIComponent(projetoId)}/entorno`,
    { token: await tokenParaAcao() },
  );
  if (r.status !== 200) return { entorno: null, motivo: 'indisponivel' };
  if (r.dados.semLocalizacao || !r.dados.centro) return { entorno: null, motivo: 'sem_localizacao' };
  return { entorno: { centro: r.dados.centro, predios: r.dados.predios, atribuicao: r.dados.atribuicao } };
}

/** Link assinado novo para abrir um arquivo (os links vencem; pedir só na hora de usar). */
export async function linkDoArquivo(arquivoId: string): Promise<string | null> {
  const r = await api<{ url: string }>(`/arquivos/${encodeURIComponent(arquivoId)}/download`, { token: await tokenParaAcao() });
  return r.status === 200 ? r.dados.url : null;
}

/** Endereço da transmissão de status ao vivo do prédio (bilhete de 2 min, preso ao prédio). */
export async function bilheteAoVivo(predioId: string): Promise<string | null> {
  const r = await api<{ url: string }>(`/predios/${encodeURIComponent(predioId)}/ao-vivo`, { metodo: 'POST', corpo: {}, token: await tokenParaAcao() });
  return r.status === 200 ? r.dados.url : null;
}

export type NovoLazer = { categoria: CategoriaLazer; nome: string; descricao: string | null; x: number; y: number; z: number };
const ERROS_LAZER: Record<number, string> = {
  400: 'Confira o nome e a posição do ponto.',
  403: 'Só a gestão (com verificação em duas etapas) marca o lazer.',
  409: 'Limite de pontos do lazer atingido para este prédio.',
};

/** Gestão: ponto do lazer marcado clicando no 3D (a posição vem da cena). */
export async function criarLazer(predioId: string, d: NovoLazer): Promise<{ item?: ItemLazer; erro?: string }> {
  const r = await api<ItemLazer>(`/predios/${encodeURIComponent(predioId)}/lazer`, { metodo: 'POST', corpo: d, token: await tokenParaAcao() });
  return r.status === 201 ? { item: r.dados } : { erro: ERROS_LAZER[r.status] ?? 'Não foi possível salvar o ponto agora.' };
}

export async function removerLazer(id: string): Promise<{ erro?: string }> {
  const r = await api(`/lazer/${encodeURIComponent(id)}`, { metodo: 'DELETE', token: await tokenParaAcao() });
  return r.status === 204 ? {} : { erro: ERROS_LAZER[r.status] ?? 'Não foi possível remover o ponto agora.' };
}
