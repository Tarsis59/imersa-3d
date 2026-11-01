/**
 * Estande de vendas: quando ninguém mexe na tela por `ociosoS` segundos, volta à apresentação automática e recomeça
 * do zero para o próximo visitante (sem a unidade, os filtros ou o corte de quem acabou de sair).
 */
export interface EstadoEstande {
  apresentando: boolean;
  ultimoToque: number;
  /** Muda a cada volta à apresentação: a Vitrine limpa o que o visitante anterior deixou. */
  reinicio: number;
}

export const OCIOSO_PADRAO_S = 90;

/** `?ocioso=` do endereço (segundos), entre 5 s e 1 h; qualquer outra coisa = padrão. */
export function lerOcioso(valor: string | null | undefined): number {
  const n = Number(valor);
  return valor && Number.isInteger(n) && n >= 5 && n <= 3600 ? n : OCIOSO_PADRAO_S;
}

export const SINAL_PADRAO_S = 60;

/** `?sinal=` (segundos entre os sinais de vida), entre 5 s e 10 min; qualquer outra coisa = padrão. */
export function lerSinal(valor: string | null | undefined): number {
  const n = Number(valor);
  return valor && Number.isInteger(n) && n >= 5 && n <= 600 ? n : SINAL_PADRAO_S;
}

export const inicial = (agora: number): EstadoEstande => ({ apresentando: true, ultimoToque: agora, reinicio: 0 });

/** Alguém tocou na tela: sai da apresentação (se estava) e o relógio do ócio recomeça. */
export function tocar(e: EstadoEstande, agora: number): EstadoEstande {
  return { ...e, apresentando: false, ultimoToque: agora };
}

/** Conferido a cada segundo: ocioso há tempo suficiente → apresentação e recomeço. */
export function conferir(e: EstadoEstande, agora: number, ociosoS: number): EstadoEstande {
  if (e.apresentando || agora - e.ultimoToque < ociosoS * 1000) return e;
  return { apresentando: true, ultimoToque: e.ultimoToque, reinicio: e.reinicio + 1 };
}
