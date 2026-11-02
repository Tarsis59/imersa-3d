'use server';
import type { Entorno, TerrenoLoteamentoLido } from '@imersa/viewer';
import { api } from '@/lib/api';
import { tokenParaAcao } from '@/lib/sessao';
import type { CategoriaLazer, GrupoLazer, ItemLazer } from '@/lib/tipos';
import type { PontoProximo, RotaAPe } from './proximidades';

export type ResultadoEntorno = { entorno: Entorno } | { entorno: null; motivo: 'sem_localizacao' | 'indisponivel' };

/** Prédios, ruas, verde, água e relevo reais em volta do empreendimento. Carregado depois do prédio, para a primeira imagem não esperar o OSM. */
export async function carregarEntorno(projetoId: string): Promise<ResultadoEntorno> {
  const r = await api<{ semLocalizacao: boolean; centro: Entorno['centro'] | null; predios: Entorno['predios']; vias?: Entorno['vias']; areas?: Entorno['areas']; relevo?: Entorno['relevo']; atribuicao: string }>(
    `/projetos/${encodeURIComponent(projetoId)}/entorno`,
    { token: await tokenParaAcao() },
  );
  if (r.status !== 200) return { entorno: null, motivo: 'indisponivel' };
  if (r.dados.semLocalizacao || !r.dados.centro) return { entorno: null, motivo: 'sem_localizacao' };
  return { entorno: { centro: r.dados.centro, predios: r.dados.predios, vias: r.dados.vias ?? [], areas: r.dados.areas ?? [], relevo: r.dados.relevo ?? null, atribuicao: r.dados.atribuicao } };
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

export type NovoLazer = { categoria: CategoriaLazer; grupo?: GrupoLazer; nome: string; descricao: string | null; x: number; y: number; z: number; fotos?: string[] };
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

export type FotoProjeto = { id: string; nome: string };
/** Fotos já prontas do projeto (foto, fachada, render): para a ficha das áreas comuns e a galeria (Plano 12b). */
export async function fotosDoProjeto(predioId: string): Promise<FotoProjeto[]> {
  const r = await api<FotoProjeto[]>(`/predios/${encodeURIComponent(predioId)}/fotos-projeto`, { token: await tokenParaAcao() });
  return r.status === 200 ? r.dados : [];
}

/** Galeria do empreendimento (Plano 12b, item 7): ids das fotos escolhidas, já na ordem da gestão. */
export async function buscarGaleria(predioId: string): Promise<FotoProjeto[]> {
  const r = await api<FotoProjeto[]>(`/predios/${encodeURIComponent(predioId)}/galeria`, { token: await tokenParaAcao() });
  return r.status === 200 ? r.dados : [];
}

export async function salvarGaleria(predioId: string, fotos: string[]): Promise<{ erro?: string }> {
  const r = await api(`/predios/${encodeURIComponent(predioId)}/galeria`, { metodo: 'PUT', corpo: { fotos }, token: await tokenParaAcao() });
  return r.status === 200 ? {} : { erro: 'Não foi possível salvar a galeria agora.' };
}

/** O que há perto do empreendimento, com o tempo a pé (Plano 12). */
export async function listarPontos(projetoId: string): Promise<PontoProximo[] | null> {
  const r = await api<{ pois: PontoProximo[] }>(`/projetos/${encodeURIComponent(projetoId)}/pois`, { token: await tokenParaAcao() });
  return r.status === 200 ? r.dados.pois : null;
}

/** A rota a pé pelas ruas até o ponto, para desenhar no chão. */
export async function rotaAte(projetoId: string, poiId: string): Promise<RotaAPe | null> {
  if (!/^[0-9a-f-]{36}$/i.test(poiId)) return null;
  const r = await api<{ rota: RotaAPe | null }>(`/projetos/${encodeURIComponent(projetoId)}/pois/${poiId}/rota`, { token: await tokenParaAcao() });
  return r.status === 200 ? r.dados.rota : null;
}

/** Terreno e infraestrutura do loteamento, lidos do DXF (Plano 12d, item 8): ruas, calçadas, meio-fio e curvas. */
export async function buscarTerrenoLoteamento(predioId: string): Promise<TerrenoLoteamentoLido | null> {
  const r = await api<TerrenoLoteamentoLido>(`/predios/${encodeURIComponent(predioId)}/terreno`, { token: await tokenParaAcao() });
  if (r.status !== 200) return null;
  return r.dados.ruas.length || r.dados.calcadas.length || r.dados.meioFio.length || r.dados.curvas.length ? r.dados : null;
}
