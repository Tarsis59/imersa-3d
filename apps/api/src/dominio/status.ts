import { ehGestao, type Papel } from '../auth/rbac';

export const STATUS_UNIDADE = ['disponivel', 'reservado', 'vendido', 'bloqueado'] as const;
export type StatusUnidade = (typeof STATUS_UNIDADE)[number];

const TRANSICOES: Record<StatusUnidade, readonly StatusUnidade[]> = {
  disponivel: ['reservado', 'vendido', 'bloqueado'],
  reservado: ['disponivel', 'vendido'],
  bloqueado: ['disponivel'],
  vendido: ['disponivel'],
};

export type ResultadoTransicao = { ok: true } | { ok: false; erro: 'transicao_invalida' | 'sem_permissao' | 'motivo_obrigatorio' };

/** Reservar e cancelar reserva: gestão e consultora. Todo o resto: só gestão. Distrato exige motivo. */
export function validarTransicao(papel: Papel, de: StatusUnidade, para: StatusUnidade, motivo?: string): ResultadoTransicao {
  if (!TRANSICOES[de].includes(para)) return { ok: false, erro: 'transicao_invalida' };
  const ehReserva = (de === 'disponivel' && para === 'reservado') || (de === 'reservado' && para === 'disponivel');
  if (!ehGestao(papel) && !(ehReserva && papel === 'consultora')) return { ok: false, erro: 'sem_permissao' };
  if (de === 'vendido' && !motivo?.trim()) return { ok: false, erro: 'motivo_obrigatorio' };
  return { ok: true };
}

export const transicoesPermitidas = (papel: Papel, de: StatusUnidade): StatusUnidade[] =>
  TRANSICOES[de].filter((para) => validarTransicao(papel, de, para, 'motivo').ok);
