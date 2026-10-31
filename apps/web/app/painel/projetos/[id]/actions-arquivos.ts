'use server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';
import type { TipoArquivo } from '@/lib/tipos';

const caminho = (projetoId: string) => `/painel/projetos/${projetoId}`;
/** A API devolve detalhe em `mensagem` quando a extensão ou o tamanho não são aceitos. */
const explicar = (status: number, dados: unknown) => (dados as { mensagem?: string }).mensagem ?? mensagem(status, dados);

export type Envio = { ok: true; id: string; url: string; metodo: 'PUT'; cabecalhos: Record<string, string> } | { ok: false; erro: string };

export async function prepararEnvio(projetoId: string, nome: string, tipo: TipoArquivo, tamanho: number): Promise<Envio> {
  const r = await api<{ id: string; envio: { url: string; metodo: 'PUT'; cabecalhos: Record<string, string> } }>(`/projetos/${projetoId}/arquivos`, {
    metodo: 'POST',
    corpo: { nome, tipo, tamanho },
    token: await tokenParaAcao(),
  });
  if (r.status !== 201) return { ok: false, erro: explicar(r.status, r.dados) };
  return { ok: true, id: r.dados.id, ...r.dados.envio };
}

export async function concluirEnvio(projetoId: string, arquivoId: string): Promise<{ status?: string; erro?: string }> {
  const r = await api<{ status: string; motivo?: string | null }>(`/arquivos/${arquivoId}/concluir`, { metodo: 'POST', corpo: {}, token: await tokenParaAcao() });
  revalidatePath(caminho(projetoId));
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  return { status: r.dados.status, erro: r.dados.motivo ?? undefined };
}

export async function apagarArquivo(projetoId: string, arquivoId: string): Promise<void> {
  await api(`/arquivos/${arquivoId}`, { metodo: 'DELETE', token: await tokenParaAcao() });
  revalidatePath(caminho(projetoId));
}

export interface EstadoBusca {
  erro?: string;
  resultados?: Array<{ rotulo: string; lat: number; lon: number }>;
}

export async function buscarEndereco(_: EstadoBusca, form: FormData): Promise<EstadoBusca> {
  const q = String(form.get('endereco') ?? '').trim();
  if (q.length < 5) return { erro: 'Digite o endereço com pelo menos 5 letras.' };
  const r = await api<EstadoBusca['resultados']>(`/geocodificar?q=${encodeURIComponent(q)}`, { token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  return r.dados?.length ? { resultados: r.dados } : { erro: 'Nenhum endereço encontrado. Tente com cidade e estado.' };
}

export async function usarEndereco(projetoId: string, rotulo: string, lat: number, lon: number): Promise<{ erro?: string }> {
  const r = await api(`/projetos/${projetoId}`, { metodo: 'PATCH', corpo: { lat, lon, endereco: rotulo.slice(0, 300) }, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(caminho(projetoId));
  return {};
}

export interface EstadoPois {
  erro?: string;
  ok?: string;
}

export async function importarPois(projetoId: string, _: EstadoPois, form: FormData): Promise<EstadoPois> {
  const raioM = Number(form.get('raioM') ?? 1000);
  const r = await api<{ encontrados: number; novos: number }>(`/projetos/${projetoId}/pois/osm`, { metodo: 'POST', corpo: { raioM }, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(caminho(projetoId));
  return { ok: `${r.dados.encontrados} pontos encontrados (${r.dados.novos} novos).` };
}
