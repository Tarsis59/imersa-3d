/**
 * Simulação de financiamento imobiliário (SAC e Price), feita no navegador. É uma estimativa para a conversa de
 * venda: taxa, seguros e aprovação de crédito são do banco (a tela avisa).
 */
export interface DadosSimulacao {
  preco: number;
  entrada: number;
  /** FGTS usado na entrada (soma à entrada). */
  fgts: number;
  prazoMeses: number;
  /** Taxa efetiva ao ano, em % (ex.: 11,5). */
  taxaAnual: number;
}

export interface ResultadoSimulacao {
  financiado: number;
  taxaMensal: number;
  sac: { primeira: number; ultima: number; totalPago: number; juros: number };
  price: { parcela: number; totalPago: number; juros: number };
  /** Renda familiar sugerida para a 1ª parcela caber em 30% (regra usual dos bancos). */
  rendaSugerida: number;
}

export const PRAZO_MAXIMO_MESES = 420;

/** Taxa efetiva anual (%) → mensal equivalente (fração). */
export const taxaMensal = (anualPct: number): number => Math.pow(1 + anualPct / 100, 1 / 12) - 1;

const centavos = (v: number) => Math.round(v * 100) / 100;

export function simular(d: DadosSimulacao): ResultadoSimulacao | null {
  const n = Math.round(d.prazoMeses);
  if (!(d.preco > 0) || n < 1 || n > PRAZO_MAXIMO_MESES || d.taxaAnual < 0 || d.taxaAnual > 100 || d.entrada < 0 || d.fgts < 0) return null;
  const financiado = d.preco - d.entrada - d.fgts;
  if (financiado <= 0) return null;
  const i = taxaMensal(d.taxaAnual);
  const amortizacao = financiado / n;
  // SAC: amortização constante, juros sobre o saldo
  const primeiraSac = amortizacao + financiado * i;
  const ultimaSac = amortizacao + amortizacao * i;
  const jurosSac = i * amortizacao * ((n * (n + 1)) / 2); // soma dos saldos × i
  // Price: parcela constante
  const parcela = i === 0 ? financiado / n : (financiado * i) / (1 - Math.pow(1 + i, -n));
  return {
    financiado: centavos(financiado),
    taxaMensal: i,
    sac: { primeira: centavos(primeiraSac), ultima: centavos(ultimaSac), totalPago: centavos(financiado + jurosSac), juros: centavos(jurosSac) },
    price: { parcela: centavos(parcela), totalPago: centavos(parcela * n), juros: centavos(parcela * n - financiado) },
    rendaSugerida: centavos(primeiraSac / 0.3),
  };
}
