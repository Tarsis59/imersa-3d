'use server';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';
import type { Descricao, PlanoCriacao } from '@/lib/tipos';

export async function interpretar(texto: string): Promise<{ descricao?: Descricao; plano?: PlanoCriacao | null; erro?: string }> {
  const r = await api<{ descricao: Descricao; plano: PlanoCriacao | null }>('/criacao/interpretar', { metodo: 'POST', corpo: { texto }, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  return r.dados;
}

export async function recalcularPlano(descricao: Descricao): Promise<{ plano?: PlanoCriacao | null; erro?: string }> {
  const r = await api<{ plano: PlanoCriacao | null }>('/criacao/plano', { metodo: 'POST', corpo: descricao, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  return r.dados;
}

export interface PedidoCriacao {
  nome: string;
  texto: string;
  descricao: Descricao;
  planilha: string | null;
  pistas: { gps?: Array<{ lat: number; lon: number }>; cep?: string | null; local?: { lat: number; lon: number; rotulo: string } | null };
}

export async function criarEmpreendimento(p: PedidoCriacao): Promise<{ projetoId?: string; montagemId?: string; erro?: string }> {
  const r = await api<{ projetoId: string; montagemId: string; erros?: Array<{ linha: number; mensagem: string }> }>('/criacao', { metodo: 'POST', corpo: p, token: await tokenParaAcao() });
  if (r.status === 201) return r.dados;
  const erro = (r.dados as { erro?: string }).erro;
  if (erro === 'sem_andares') return { erro: 'Diga quantos andares o prédio tem (ou largue a planilha de unidades).' };
  if (erro === 'planilha_invalida') return { erro: `A planilha tem erros: ${(r.dados.erros ?? []).slice(0, 3).map((e) => `linha ${e.linha}: ${e.mensagem}`).join('; ')}.` };
  return { erro: mensagem(r.status, r.dados) };
}

export async function iniciarMontagem(
  montagemId: string,
  corpo: { arquivos?: Array<{ id: string; papel: string }>; cep?: string | null; local?: { lat: number; lon: number; rotulo: string } | null },
): Promise<{ erro?: string }> {
  const r = await api(`/montagens/${montagemId}/iniciar`, { metodo: 'POST', corpo, token: await tokenParaAcao() });
  if (r.status === 202) return {};
  if ((r.dados as { erro?: string }).erro === 'montagem_em_andamento') return { erro: 'A montagem já está rodando.' };
  return { erro: mensagem(r.status, r.dados) };
}

export async function geocodificar(q: string): Promise<{ resultados?: Array<{ rotulo: string; lat: number; lon: number }>; erro?: string }> {
  if (q.trim().length < 5) return { erro: 'Digite o endereço com pelo menos 5 letras.' };
  const r = await api<Array<{ rotulo: string; lat: number; lon: number }>>(`/geocodificar?q=${encodeURIComponent(q.trim())}`, { token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  return r.dados.length ? { resultados: r.dados } : { erro: 'Nenhum endereço encontrado. Tente com cidade e estado, ou o CEP.' };
}
