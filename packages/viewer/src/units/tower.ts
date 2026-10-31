export type Status = 'disponivel' | 'reservado' | 'vendido';

export const COR_STATUS: Record<Status, number> = {
  disponivel: 0x22c55e,
  reservado: 0xeab308,
  vendido: 0xef4444,
};

export const ROTULO_STATUS: Record<Status, string> = {
  disponivel: 'Disponível',
  reservado: 'Reservado',
  vendido: 'Vendido',
};

export interface Caixa {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface Unidade {
  codigo: string;
  andar: number;
  final: number;
  status: Status;
  areaM2: number;
  quartos: number;
  precoReais: number;
  caixa: Caixa;
}

export interface ConfigTorre {
  andares: number;
  unidadesPorAndar: 4;
  alturaAndarM: number;
  larguraM: number;
}

/** Dados FICTÍCIOS de demonstração; em produção vêm da API/CRM. */
export function statusPara(andar: number, final: number): Status {
  const h = (andar * 31 + final * 17) % 10;
  if (h < 5) return 'disponivel';
  if (h < 7) return 'reservado';
  return 'vendido';
}

export function gerarUnidades(c: ConfigTorre): Unidade[] {
  const meia = c.larguraM / 2;
  const quadrantes: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const lista: Unidade[] = [];
  for (let andar = 1; andar <= c.andares; andar++) {
    quadrantes.forEach(([sx, sz], i) => {
      const final = i + 1;
      const areaM2 = final % 2 === 0 ? 98 : 72;
      lista.push({
        codigo: `${andar}${String(final).padStart(2, '0')}`,
        andar,
        final,
        status: statusPara(andar, final),
        areaM2,
        quartos: areaM2 > 90 ? 3 : 2,
        precoReais: Math.round(areaM2 * (14_500 + andar * 180)),
        caixa: {
          minX: sx < 0 ? -meia : 0,
          maxX: sx < 0 ? 0 : meia,
          minY: (andar - 1) * c.alturaAndarM,
          maxY: andar * c.alturaAndarM,
          minZ: sz < 0 ? -meia : 0,
          maxZ: sz < 0 ? 0 : meia,
        },
      });
    });
  }
  return lista;
}

export function resumo(u: Unidade[]): Record<Status, number> {
  const r: Record<Status, number> = { disponivel: 0, reservado: 0, vendido: 0 };
  for (const x of u) r[x.status]++;
  return r;
}
