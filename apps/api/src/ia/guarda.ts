/**
 * Guarda de preço: todo valor em reais da resposta tem de ter vindo das ferramentas nesta conversa (ou ser um
 * arredondamento dele, ex.: R$ 849.900 dito "R$ 850 mil"). Preço inventado é o erro mais caro numa venda.
 */
const MULTIPLICADOR: Record<string, number> = { mil: 1e3, milhao: 1e6, milhoes: 1e6, mi: 1e6, bi: 1e9, bilhao: 1e9, bilhoes: 1e9 };
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "1.234.567,89" / "850" / "1,2" → número (ponto é milhar, vírgula é decimal). */
const numeroBr = (txt: string): number => Number(txt.replace(/\./g, '').replace(',', '.'));

/** Valores em reais citados no texto: "R$ 850.000", "R$ 1,2 milhão", "850 mil reais", "R$850 mil". */
export function valoresEmReais(texto: string): number[] {
  const t = semAcento(texto);
  const valores: number[] = [];
  const padroes = [
    /r\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d+)?)(?:\s*(mil|milhao|milhoes|mi|bilhao|bilhoes|bi)\b)?/g,
    /(?<!r\$\s{0,3})(?<![\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d+)?)\s*(mil|milhao|milhoes|bilhao|bilhoes)?\s*(?:de\s+)?reais\b/g,
  ];
  const vistos = new Set<number>();
  for (const re of padroes) {
    for (const m of t.matchAll(re)) {
      if (vistos.has(m.index!)) continue;
      vistos.add(m.index!);
      const mult = m[2] ? MULTIPLICADOR[m[2]]! : 1;
      const v = numeroBr(m[1]!) * mult;
      if (Number.isFinite(v) && v > 0) valores.push(v);
    }
  }
  return valores;
}

/** Valores da resposta que não batem (±1%) com nenhum preço recebido das ferramentas. */
export function precosInventados(texto: string, permitidos: readonly number[]): number[] {
  return valoresEmReais(texto).filter((v) => !permitidos.some((p) => p > 0 && Math.abs(v - p) <= p * 0.01));
}

export const RESPOSTA_SEM_PRECO =
  'Não consigo confirmar esse valor agora. Os preços que valem são os da lista de unidades: posso buscar a unidade para você, ou a consultora confirma as condições.';
