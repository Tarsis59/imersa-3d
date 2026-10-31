export interface LayoutMarca {
  alturaFaixa: number;
  alturaTotal: number;
  fonte: number;
  margem: number;
}

/** Faixa abaixo da imagem do 3D (não cobre o empreendimento): 8% da altura, entre 40 e 120 px. */
export function layoutMarca(largura: number, altura: number): LayoutMarca {
  const alturaFaixa = Math.min(120, Math.max(40, Math.round(altura * 0.08)));
  // o texto precisa caber na largura do celular
  const fonte = Math.max(9, Math.round(Math.min(alturaFaixa * 0.32, largura / 40)));
  return { alturaFaixa, alturaTotal: altura + alturaFaixa, fonte, margem: Math.round(alturaFaixa * 0.3) };
}

export interface DadosMarca {
  empresa: string;
  predio: string;
  data: Date;
  /** Atribuição exigida pela licença do OSM quando o entorno aparece. */
  atribuicao?: string | null;
}

const dataBr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

export function textoDaMarca(d: DadosMarca): { esquerda: string; direita: string; rodape: string | null } {
  return { esquerda: `${d.empresa} · ${d.predio}`, direita: `Imagem ilustrativa · ${dataBr.format(d.data)}`, rodape: d.atribuicao ?? null };
}
