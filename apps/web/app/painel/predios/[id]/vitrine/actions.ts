'use server';
import type { Entorno } from '@imersa/viewer';
import { api } from '@/lib/api';
import { tokenParaAcao } from '@/lib/sessao';

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
