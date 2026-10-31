'use server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';
import type { EscolhaSuperficie, MovelColocado, Orcamento } from '@/lib/configurador';

export interface DadosSalvar {
  nome: string;
  cliente: string;
  unidadeId: string | null;
  superficies: EscolhaSuperficie[];
  moveis: MovelColocado[];
}

/** Grava a combinação (nova ou alterada). A API recalcula o orçamento com os preços do catálogo. */
export async function salvarConfiguracao(predioId: string, configuracaoId: string | null, d: DadosSalvar): Promise<{ erro?: string; id?: string; orcamento?: Orcamento }> {
  const r = await api<{ id: string; orcamento: Orcamento }>(configuracaoId ? `/configuracoes/${encodeURIComponent(configuracaoId)}` : `/predios/${encodeURIComponent(predioId)}/configuracoes`, {
    metodo: configuracaoId ? 'PUT' : 'POST',
    corpo: d,
    token: await tokenParaAcao(),
  });
  if (r.status !== 200 && r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}/configurador`);
  return { id: r.dados.id, orcamento: r.dados.orcamento };
}

export async function apagarConfiguracao(predioId: string, configuracaoId: string): Promise<{ erro?: string }> {
  const r = await api(`/configuracoes/${encodeURIComponent(configuracaoId)}`, { metodo: 'DELETE', token: await tokenParaAcao() });
  if (r.status !== 204) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(`/painel/predios/${predioId}/configurador`);
  return {};
}
