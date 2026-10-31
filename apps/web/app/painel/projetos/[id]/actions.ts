'use server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';

export interface EstadoForm {
  erro?: string;
  ok?: string;
}

const texto = (form: FormData, campo: string) => String(form.get(campo) ?? '').trim();
/** Campo opcional: vazio vira null (apaga o valor no banco). */
const opcional = (form: FormData, campo: string) => texto(form, campo) || null;
/** Aceita vírgula ou ponto decimal ("72,5" ou "-23.56"). */
function numero(form: FormData, campo: string): number | null | 'invalido' {
  const s = texto(form, campo).replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : 'invalido';
}
const caminho = (projetoId: string) => `/painel/projetos/${projetoId}`;

export async function salvarDados(projetoId: string, _: EstadoForm, form: FormData): Promise<EstadoForm> {
  const lat = numero(form, 'lat');
  const lon = numero(form, 'lon');
  if (lat === 'invalido' || lon === 'invalido') return { erro: 'Latitude e longitude devem ser números (ex.: -23.56175).' };
  if ((lat === null) !== (lon === null)) return { erro: 'Preencha latitude e longitude juntas.' };
  const corpo = {
    nome: texto(form, 'nome'),
    descricao: opcional(form, 'descricao'),
    endereco: opcional(form, 'endereco'),
    cidade: opcional(form, 'cidade'),
    uf: opcional(form, 'uf')?.toUpperCase() ?? null,
    status: texto(form, 'status'),
    ...(lat !== null && lon !== null ? { lat, lon } : {}),
  };
  const r = await api(`/projetos/${projetoId}`, { metodo: 'PATCH', corpo, token: await tokenParaAcao() });
  if (r.status !== 200) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(caminho(projetoId));
  return { ok: 'Dados salvos.' };
}

export async function criarPredio(projetoId: string, _: EstadoForm, form: FormData): Promise<EstadoForm> {
  const andares = numero(form, 'andares');
  if (andares === null || andares === 'invalido' || !Number.isInteger(andares)) return { erro: 'Informe o número de andares.' };
  const r = await api(`/projetos/${projetoId}/predios`, {
    metodo: 'POST',
    corpo: { nome: texto(form, 'nome'), andares, incluirTerreo: form.get('incluirTerreo') === 'on' },
    token: await tokenParaAcao(),
  });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(caminho(projetoId));
  return { ok: 'Prédio criado.' };
}

export async function criarTipologia(projetoId: string, _: EstadoForm, form: FormData): Promise<EstadoForm> {
  const valores = ['areaM2', 'quartos', 'suites', 'vagas'].map((c) => numero(form, c));
  if (valores.some((v) => v === 'invalido' || v === null)) return { erro: 'Preencha área, quartos, suítes e vagas com números.' };
  const [areaM2, quartos, suites, vagas] = valores as number[];
  const r = await api(`/projetos/${projetoId}/tipologias`, {
    metodo: 'POST',
    corpo: { nome: texto(form, 'nome'), areaM2, quartos, suites, vagas },
    token: await tokenParaAcao(),
  });
  if (r.status !== 201) return { erro: mensagem(r.status, r.dados) };
  revalidatePath(caminho(projetoId));
  return { ok: 'Tipologia criada.' };
}

export interface ResumoImportacao {
  prediosNovos: number;
  andaresNovos: number;
  tipologiasNovas: number;
  unidadesNovas: number;
  unidadesAlteradas: number;
  statusAlterados: number;
  semMudanca: number;
}

export interface EstadoImportacao {
  erro?: string;
  aplicado?: boolean;
  resumo?: ResumoImportacao | null;
  erros?: Array<{ linha: number; campo: string; mensagem: string }>;
  /** Texto conferido na última prévia sem erros: só ele pode ser aplicado. */
  conferido?: string;
}

export async function importar(projetoId: string, aplicar: boolean, _: EstadoImportacao, form: FormData): Promise<EstadoImportacao> {
  const csv = String(form.get('csv') ?? '');
  if (!csv.trim()) return { erro: 'Cole a planilha ou escolha o arquivo.' };
  const r = await api<{ aplicado: boolean; resumo: ResumoImportacao | null; erros: EstadoImportacao['erros'] }>(`/projetos/${projetoId}/importacao`, {
    metodo: 'POST',
    corpo: { csv, aplicar },
    token: await tokenParaAcao(),
  });
  if (r.status !== 200 && !(r.status === 400 && Array.isArray(r.dados.erros))) return { erro: mensagem(r.status, r.dados) };
  if (r.dados.aplicado) revalidatePath(caminho(projetoId));
  const semErros = (r.dados.erros ?? []).length === 0;
  return { aplicado: r.dados.aplicado, resumo: r.dados.resumo, erros: r.dados.erros ?? [], conferido: !aplicar && semErros ? csv : undefined };
}
