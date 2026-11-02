/** Vozes do Kokoro em português do Brasil: feminina (Dora) e masculina (Alex). */
export const VOZES_NARRACAO = ['pf_dora', 'pm_alex'] as const;
export type VozNarracao = (typeof VOZES_NARRACAO)[number];

export interface DadosRoteiro {
  projeto: string;
  predio: string;
  cidade: string | null;
  disponiveis: number;
  /** Menor preço entre as disponíveis (reais), ou null. */
  aPartirDe: number | null;
  /** Nomes do lazer marcado no 3D, na ordem do tour. */
  lazer: string[];
}

/** Palavras por segundo de uma locução calma em português. */
const PALAVRAS_POR_S = 2.3;
const palavras = (t: string) => t.split(/\s+/).filter(Boolean).length;

const NUMEROS = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze'];
/** "três unidades" por extenso até doze (soa melhor falado); acima, o número. */
const quantas = (n: number) => `${n <= 12 ? NUMEROS[n] : n} ${n === 1 ? 'unidade disponível' : 'unidades disponíveis'}`;

/** "R$ 650 mil" / "R$ 1,25 milhão": como se fala preço de imóvel. */
export function precoFalado(reais: number): string {
  if (reais >= 1_000_000) {
    const m = Math.round(reais / 10_000) / 100;
    return `R$ ${m.toLocaleString('pt-BR')} ${m >= 2 ? 'milhões' : 'milhão'}`;
  }
  return `R$ ${Math.round(reais / 1000).toLocaleString('pt-BR')} mil`;
}

const lista = (itens: string[]) => (itens.length <= 1 ? (itens[0] ?? '') : `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`);

/**
 * Roteiro falado do vídeo, com os dados reais do empreendimento, do tamanho do vídeo: as frases menos importantes
 * (lazer, preço) saem primeiro se não couber. Sempre termina chamando para a visita.
 */
export function roteiroDoVideo(d: DadosRoteiro, segundos = 10): string {
  const limite = Math.max(10, Math.floor(segundos * PALAVRAS_POR_S));
  const abertura = `Conheça o ${d.projeto}${d.cidade ? `, em ${d.cidade}` : ''}.`;
  const oferta = d.disponiveis > 0 ? `${d.predio}: ${quantas(d.disponiveis)}${d.aPartirDe ? `, a partir de ${precoFalado(d.aPartirDe)}` : ''}.` : null;
  const ofertaCurta = d.disponiveis > 0 ? `${d.predio}: ${quantas(d.disponiveis)}.` : null;
  const lazer = d.lazer.length ? `Lazer com ${lista(d.lazer.slice(0, 3).map((l) => l.toLowerCase()))}.` : null;
  const fecho = 'Agende sua visita.';
  for (const frases of [
    [abertura, oferta, lazer, fecho],
    [abertura, oferta, fecho],
    [abertura, ofertaCurta, fecho],
    [abertura, fecho],
  ]) {
    const texto = frases.filter(Boolean).join(' ');
    if (palavras(texto) <= limite) return texto;
  }
  return `${abertura} ${fecho}`;
}
