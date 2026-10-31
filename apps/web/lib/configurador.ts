import type { Acabamento, Padrao, PoseMovel, Superficie } from '@imersa/viewer';

export type CategoriaMaterial = 'piso' | 'parede' | 'teto' | 'telhado' | 'esquadria' | 'bancada' | 'outro';
export type CategoriaMovel = 'sala' | 'quarto' | 'cozinha' | 'banheiro' | 'escritorio' | 'externo' | 'decoracao';

export interface Material {
  id: string;
  nome: string;
  categoria: CategoriaMaterial;
  padrao: Padrao;
  cor: string;
  cor2: string | null;
  rugosidade: number;
  metalico: number;
  escalaM: number;
  precoM2: number | null;
  fornecedor: string | null;
  codigo: string | null;
  ativo: boolean;
}

export interface Movel {
  id: string;
  nome: string;
  categoria: CategoriaMovel;
  modeloPadrao: string | null;
  arquivoId: string | null;
  arquivoNome: string | null;
  preco: number | null;
  licenca: string;
  autor: string;
  fonteUrl: string | null;
  ativo: boolean;
}

export interface MovelColocado {
  instanciaId: string;
  movelId: string;
  pose: PoseMovel;
}

export interface EscolhaSuperficie {
  chave: string;
  rotulo: string;
  areaM2: number;
  materialId: string | null;
}

export interface LinhaOrcamento {
  tipo: 'superficie' | 'movel';
  descricao: string;
  item: string;
  quantidade: number;
  unidade: 'm²' | 'un';
  precoUnitario: number | null;
  valor: number;
}
export interface Orcamento {
  linhas: LinhaOrcamento[];
  total: number;
  semPreco: number;
}

export interface ConfiguracaoResumo {
  id: string;
  nome: string;
  cliente: string | null;
  unidadeId: string | null;
  unidadeCodigo: string | null;
  total: number;
  criadoEm: string;
  atualizadoEm: string;
  criadoPor: { id: string; nome: string } | null;
}

export interface ConfiguracaoDetalhe extends ConfiguracaoResumo {
  predioId: string;
  predioNome: string;
  projetoNome: string;
  escolhas: { superficies: EscolhaSuperficie[]; moveis: MovelColocado[] };
  orcamento: Orcamento;
}

export const ROTULO_CATEGORIA_MATERIAL: Record<CategoriaMaterial, string> = {
  piso: 'Piso',
  parede: 'Parede',
  teto: 'Teto / forro',
  telhado: 'Telhado',
  esquadria: 'Portas e janelas',
  bancada: 'Bancada',
  outro: 'Outro',
};
export const ROTULO_PADRAO: Record<Padrao, string> = {
  liso: 'Liso (pintura)',
  madeira: 'Madeira',
  porcelanato: 'Porcelanato',
  marmore: 'Mármore / granito',
  cimento: 'Cimento',
  tijolo: 'Tijolo / telha',
  pastilha: 'Pastilha',
};
export const ROTULO_CATEGORIA_MOVEL: Record<CategoriaMovel, string> = {
  sala: 'Sala',
  quarto: 'Quarto',
  cozinha: 'Cozinha',
  banheiro: 'Banheiro',
  escritorio: 'Escritório',
  externo: 'Área externa',
  decoracao: 'Decoração',
};

export const acabamentoDe = (m: Material): Acabamento => ({ padrao: m.padrao, cor: m.cor, cor2: m.cor2, rugosidade: m.rugosidade, metalico: m.metalico, escalaM: m.escalaM });

/** Materiais que fazem sentido para a superfície (mesma categoria); sem nenhum da categoria, todos. */
export function materiaisPara(s: Pick<Superficie, 'categoria'>, materiais: readonly Material[]): Material[] {
  const daCategoria = materiais.filter((m) => m.categoria === s.categoria);
  return daCategoria.length ? daCategoria : [...materiais];
}

/**
 * Prévia do orçamento enquanto a cliente escolhe (a mesma conta da API, em centavos). O valor oficial é o que a
 * API devolve ao salvar, com os preços do catálogo naquele momento.
 */
export function previaOrcamento(superficies: readonly EscolhaSuperficie[], moveis: readonly MovelColocado[], materiais: readonly Material[], catalogo: readonly Movel[]): Orcamento {
  const mat = new Map(materiais.map((m) => [m.id, m]));
  const mov = new Map(catalogo.map((m) => [m.id, m]));
  const linhas: LinhaOrcamento[] = [];
  let totalCent = 0;
  let semPreco = 0;
  for (const s of superficies) {
    const m = s.materialId ? mat.get(s.materialId) : undefined;
    if (!m) continue;
    const area = Math.round(s.areaM2 * 100) / 100;
    const valorCent = m.precoM2 === null ? 0 : Math.round(area * Math.round(m.precoM2 * 100));
    if (m.precoM2 === null) semPreco++;
    totalCent += valorCent;
    linhas.push({ tipo: 'superficie', descricao: s.rotulo, item: m.nome, quantidade: area, unidade: 'm²', precoUnitario: m.precoM2, valor: valorCent / 100 });
  }
  const quantos = new Map<string, number>();
  for (const x of moveis) quantos.set(x.movelId, (quantos.get(x.movelId) ?? 0) + 1);
  for (const [id, qtd] of quantos) {
    const m = mov.get(id);
    if (!m) continue;
    const valorCent = m.preco === null ? 0 : qtd * Math.round(m.preco * 100);
    if (m.preco === null) semPreco++;
    totalCent += valorCent;
    linhas.push({ tipo: 'movel', descricao: 'Móvel', item: m.nome, quantidade: qtd, unidade: 'un', precoUnitario: m.preco, valor: valorCent / 100 });
  }
  return { linhas, total: totalCent / 100, semPreco };
}

/** Número com vírgula para m² (pt-BR). */
export const m2 = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;

/** Número digitado em português: "1.234,56" → 1234.56; "0,6" e "0.6" → 0.6; vazio → null; texto ruim → NaN. */
export function numeroBr(v: FormDataEntryValue | string | null): number | null {
  const t = String(v ?? '').trim();
  if (t === '') return null;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
}

const formatoCentavos = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Valor de orçamento, com centavos (o `brl` do espelho arredonda para reais). */
export const reais = (v: number | null) => (v === null ? 'sem preço' : formatoCentavos.format(v));
