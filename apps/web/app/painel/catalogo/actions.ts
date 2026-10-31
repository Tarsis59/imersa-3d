'use server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { numeroBr } from '@/lib/configurador';
import { tokenParaAcao } from '@/lib/sessao';

export type Resultado = { erro?: string; ok?: string };

const texto = (v: FormDataEntryValue | null) => String(v ?? '').trim();

export async function criarMaterial(_: Resultado, f: FormData): Promise<Resultado> {
  const corpo = {
    nome: texto(f.get('nome')),
    categoria: texto(f.get('categoria')),
    padrao: texto(f.get('padrao')),
    cor: texto(f.get('cor')),
    escalaM: numeroBr(f.get('escalaM')) ?? 0.6,
    rugosidade: numeroBr(f.get('rugosidade')) ?? 0.8,
    metalico: numeroBr(f.get('metalico')) ?? 0,
    precoM2: numeroBr(f.get('precoM2')),
    fornecedor: texto(f.get('fornecedor')),
  };
  if (corpo.precoM2 !== null && !Number.isFinite(corpo.precoM2)) return { erro: 'Preço inválido. Use, por exemplo, 89,90.' };
  const r = await api(`/materiais`, { metodo: 'POST', corpo, token: await tokenParaAcao() });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath('/painel/catalogo');
  return { ok: `Material "${corpo.nome}" cadastrado.` };
}

export async function alterarMaterial(id: string, mudanca: { precoM2?: number | null; ativo?: boolean }): Promise<Resultado> {
  const r = await api(`/materiais/${encodeURIComponent(id)}`, { metodo: 'PATCH', corpo: mudanca, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath('/painel/catalogo');
  return { ok: 'Salvo.' };
}

export async function catalogoInicial(): Promise<Resultado> {
  const r = await api<{ materiais: number; moveis: number }>(`/materiais/catalogo-inicial`, { metodo: 'POST', corpo: {}, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath('/painel/catalogo');
  return { ok: `${r.dados.materiais} materiais e ${r.dados.moveis} móveis adicionados. Coloque os preços para o orçamento sair completo.` };
}

export async function criarMovel(_: Resultado, f: FormData): Promise<Resultado> {
  const corpo = {
    nome: texto(f.get('nome')),
    categoria: texto(f.get('categoria')),
    arquivoId: texto(f.get('arquivoId')),
    preco: numeroBr(f.get('preco')),
    licenca: texto(f.get('licenca')),
    autor: texto(f.get('autor')),
    fonteUrl: texto(f.get('fonteUrl')) || null,
  };
  const r = await api(`/moveis`, { metodo: 'POST', corpo, token: await tokenParaAcao() });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath('/painel/catalogo');
  return { ok: `Móvel "${corpo.nome}" cadastrado.` };
}

export async function alterarMovel(id: string, mudanca: { preco?: number | null; ativo?: boolean }): Promise<Resultado> {
  const r = await api(`/moveis/${encodeURIComponent(id)}`, { metodo: 'PATCH', corpo: mudanca, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath('/painel/catalogo');
  return { ok: 'Salvo.' };
}
