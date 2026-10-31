export const PAPEIS = ['super_admin', 'admin', 'consultora', 'produtor', 'viewer'] as const;
export type Papel = (typeof PAPEIS)[number];

export type Acao = 'projeto:ler' | 'projeto:criar' | 'membro:convidar' | 'auditoria:ler';

const TODOS: readonly Papel[] = PAPEIS;
const GESTAO: readonly Papel[] = ['super_admin', 'admin'];
const SENSIVEIS: readonly Acao[] = ['projeto:criar', 'membro:convidar', 'auditoria:ler'];

const MATRIZ: Record<Acao, readonly Papel[]> = {
  'projeto:ler': TODOS,
  'projeto:criar': GESTAO,
  'membro:convidar': GESTAO,
  'auditoria:ler': GESTAO,
};

export const pode = (papel: Papel, acao: Acao): boolean => MATRIZ[acao].includes(papel);

/** Gestão só faz ação sensível com sessão que passou por MFA. */
export const exigeMfa = (papel: Papel, acao: Acao): boolean => GESTAO.includes(papel) && SENSIVEIS.includes(acao);
