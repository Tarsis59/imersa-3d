/**
 * Missões e conquistas da Vitrine (Plano 11d, item 17): pequenas metas que levam o cliente a conhecer o empreendimento
 * inteiro. Cada missão completa vira evento (Números) e esquenta o lead no CRM.
 */
export type IdMissao = 'lazer' | 'tipologias' | 'por_dentro' | 'por_do_sol' | 'a_pe';

export const MISSOES: ReadonlyArray<{ id: IdMissao; titulo: string; dica: string }> = [
  { id: 'lazer', titulo: 'Conheça o lazer', dica: 'Faça o tour do lazer até o fim.' },
  { id: 'tipologias', titulo: 'Visite as tipologias', dica: 'Abra uma unidade de cada tipo de planta.' },
  { id: 'por_dentro', titulo: 'Entre num apartamento', dica: 'Escolha uma unidade e entre nela.' },
  { id: 'por_do_sol', titulo: 'Veja o pôr do sol da unidade', dica: 'Abra a vista de uma unidade e ponha a hora entre 17h e 19h.' },
  { id: 'a_pe', titulo: 'Passeie a pé', dica: 'Ande 50 m pela rua no modo a pé.' },
];

/** Metros a pé para a missão de passeio. */
export const PASSEIO_M = 50;
/** Pulo maior que isso entre duas posições é teleporte (entrar na unidade, voltar à rua), não caminhada. */
const TELEPORTE_M = 15;

/** Tipo de planta de uma unidade: quartos + área (sem tipologia no 3D, é o que distingue). */
export const tipoDaUnidade = (u: { quartos: number | null; areaM2: number | null }): string => `${u.quartos ?? '?'}|${u.areaM2 ?? '?'}`;

/** Quantos tipos de planta faltam ver: a meta é ver até 3 tipos diferentes (ou todos, se houver menos). */
export function progressoTipologias(vistas: ReadonlySet<string>, todas: ReadonlyArray<{ id: string; quartos: number | null; areaM2: number | null }>): { vistos: number; meta: number } {
  const tipos = new Set(todas.map(tipoDaUnidade));
  const doId = new Map(todas.map((u) => [u.id, tipoDaUnidade(u)]));
  const vistos = new Set([...vistas].map((id) => doId.get(id)).filter((t): t is string => !!t));
  return { vistos: vistos.size, meta: Math.min(3, tipos.size) };
}

/** Distância andada somando os passos (sem contar teleportes). */
export function somarCaminhada(total: number, de: { x: number; z: number } | null, para: { x: number; z: number }): number {
  if (!de) return total;
  const d = Math.hypot(para.x - de.x, para.z - de.z);
  return d > TELEPORTE_M ? total : total + d;
}

/** Pôr do sol da unidade: vendo a vista (ou dentro dela) com a hora no fim de tarde. */
export const ehPorDoSol = (hora: number, vendoUnidade: boolean): boolean => vendoUnidade && hora >= 17 && hora <= 19;
