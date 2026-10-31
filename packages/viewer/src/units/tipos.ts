export type StatusUnidade = 'disponivel' | 'reservado' | 'vendido' | 'bloqueado';

/** Mesmas cores do espelho de vendas do site. */
export const COR_UNIDADE: Record<StatusUnidade, number> = {
  disponivel: 0x059669,
  reservado: 0xfbbf24,
  vendido: 0xdc2626,
  bloqueado: 0x64748b,
};

export interface Caixa {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Unidade como o viewer precisa: vem do espelho de vendas da API. */
export interface UnidadeViewer {
  id: string;
  codigo: string;
  /** Número do andar (0 = térreo, negativo = subsolo). */
  andar: number;
  status: StatusUnidade;
  areaM2: number | null;
  quartos: number | null;
  preco: number | null;
  /** Nome da peça no modelo GLB, quando ligada. */
  meshNodeId: string | null;
}
