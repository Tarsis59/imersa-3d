/**
 * Orçamento do configurador: área de cada superfície (medida no 3D) × preço por m² do material, mais os móveis
 * (quantidade × preço). Conta em centavos inteiros, para não perder centavo em soma de ponto flutuante.
 * Sem preço no catálogo, a linha entra marcada "sem preço" e não soma (o total diz quantas ficaram de fora).
 */
export interface MaterialPreco {
  id: string;
  nome: string;
  precoM2: number | null;
}
export interface MovelPreco {
  id: string;
  nome: string;
  preco: number | null;
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
  /** superfície: o material; móvel: o próprio móvel */
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

const centavos = (v: number) => Math.round(v * 100);

export function calcularOrcamento(
  superficies: readonly EscolhaSuperficie[],
  moveis: readonly { movelId: string }[],
  materiais: ReadonlyMap<string, MaterialPreco>,
  catalogoMoveis: ReadonlyMap<string, MovelPreco>,
): Orcamento {
  const linhas: LinhaOrcamento[] = [];
  let totalCent = 0;
  let semPreco = 0;
  for (const s of superficies) {
    if (!s.materialId) continue;
    const m = materiais.get(s.materialId);
    if (!m) throw new Error(`material fora do catálogo: ${s.materialId}`);
    const area = Math.round(s.areaM2 * 100) / 100;
    const valorCent = m.precoM2 === null ? 0 : Math.round(area * centavos(m.precoM2));
    if (m.precoM2 === null) semPreco++;
    totalCent += valorCent;
    linhas.push({ tipo: 'superficie', descricao: s.rotulo, item: m.nome, quantidade: area, unidade: 'm²', precoUnitario: m.precoM2, valor: valorCent / 100 });
  }
  // móveis iguais viram uma linha só (2 cadeiras = quantidade 2), na ordem em que apareceram
  const quantos = new Map<string, number>();
  for (const x of moveis) quantos.set(x.movelId, (quantos.get(x.movelId) ?? 0) + 1);
  for (const [id, qtd] of quantos) {
    const m = catalogoMoveis.get(id);
    if (!m) throw new Error(`móvel fora do catálogo: ${id}`);
    const valorCent = m.preco === null ? 0 : qtd * centavos(m.preco);
    if (m.preco === null) semPreco++;
    totalCent += valorCent;
    linhas.push({ tipo: 'movel', descricao: 'Móvel', item: m.nome, quantidade: qtd, unidade: 'un', precoUnitario: m.preco, valor: valorCent / 100 });
  }
  return { linhas, total: totalCent / 100, semPreco };
}
