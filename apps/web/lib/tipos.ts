export interface Me {
  userId: string;
  tenantId: string;
  papel: 'super_admin' | 'admin' | 'consultora' | 'produtor' | 'viewer';
  mfa: boolean;
  mfaAtivo: boolean;
  nome: string;
  email: string;
  empresas: Array<{ id: string; nome: string; slug: string; papel: string }>;
}

export const ehGestao = (papel: Me['papel']) => papel === 'admin' || papel === 'super_admin';

export type StatusProjeto = 'rascunho' | 'lancamento' | 'em_obra' | 'pronto' | 'arquivado';
export const ROTULO_STATUS_PROJETO: Record<StatusProjeto, string> = {
  rascunho: 'Rascunho',
  lancamento: 'Lançamento',
  em_obra: 'Em obra',
  pronto: 'Pronto',
  arquivado: 'Arquivado',
};

export interface Projeto {
  id: string;
  nome: string;
  status: StatusProjeto;
  cidade: string | null;
  uf: string | null;
  criado_em: string;
}

export type StatusUnidade = 'disponivel' | 'reservado' | 'vendido' | 'bloqueado';
export const STATUS_UNIDADE: readonly StatusUnidade[] = ['disponivel', 'reservado', 'vendido', 'bloqueado'];
export const ROTULO_STATUS: Record<StatusUnidade, string> = {
  disponivel: 'Disponível',
  reservado: 'Reservado',
  vendido: 'Vendido',
  bloqueado: 'Bloqueado',
};
/** Mesmas cores do protótipo 3D (verde/amarelo/vermelho) + cinza para bloqueado. */
export const COR_STATUS: Record<StatusUnidade, string> = {
  disponivel: 'bg-emerald-600 text-white',
  reservado: 'bg-amber-400 text-amber-950',
  vendido: 'bg-red-600 text-white',
  bloqueado: 'bg-slate-500 text-white',
};

export interface DetalheProjeto {
  projeto: {
    id: string;
    nome: string;
    descricao: string | null;
    endereco: string | null;
    cidade: string | null;
    uf: string | null;
    lat: number | null;
    lon: number | null;
    altitudeM: number | null;
    rotacaoGraus: number;
    status: StatusProjeto;
  };
  predios: Array<{ id: string; nome: string; andares: number; unidades: number }>;
  tipologias: Array<{ id: string; nome: string; areaM2: number; quartos: number; suites: number; vagas: number }>;
  resumo: Record<StatusUnidade, number> & { total: number };
}

export interface UnidadeEspelho {
  id: string;
  codigo: string;
  status: StatusUnidade;
  preco: number | null;
  tipologia: string | null;
  areaM2: number | null;
  quartos: number | null;
  transicoes: StatusUnidade[];
}

export interface Espelho {
  predio: { id: string; nome: string; projetoId: string; projetoNome: string };
  andares: Array<{ id: string; numero: number; nome: string; unidades: UnidadeEspelho[] }>;
}

const formatoReal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const brl = (v: number | null) => (v === null ? '—' : formatoReal.format(v));
