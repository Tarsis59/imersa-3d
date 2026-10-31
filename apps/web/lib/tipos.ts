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
  meshNodeId: string | null;
  transicoes: StatusUnidade[];
}

export interface Espelho {
  predio: { id: string; nome: string; projetoId: string; projetoNome: string; modeloArquivoId: string | null };
  andares: Array<{ id: string; numero: number; nome: string; unidades: UnidadeEspelho[] }>;
}

const formatoReal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const brl = (v: number | null) => (v === null ? '—' : formatoReal.format(v));

export type TipoArquivo = 'modelo_3d' | 'splat' | 'ifc' | 'planta' | 'imagem' | 'documento' | 'captura';
export const ROTULO_TIPO_ARQUIVO: Record<TipoArquivo, string> = {
  modelo_3d: 'Modelo 3D (.glb)',
  splat: 'Interior real (splat)',
  ifc: 'Projeto BIM (.ifc)',
  planta: 'Planta',
  imagem: 'Imagem',
  documento: 'Documento (.pdf)',
  captura: 'Fotos ou vídeo para 3D (.zip, .mp4, .mov)',
};
export const ACEITA_POR_TIPO: Record<TipoArquivo, string> = {
  modelo_3d: '.glb',
  splat: '.spz,.ply,.splat,.sog',
  ifc: '.ifc',
  planta: '.pdf,.png,.jpg,.jpeg,.dwg',
  imagem: '.png,.jpg,.jpeg,.webp',
  documento: '.pdf',
  captura: '.zip,.mp4,.mov',
};

export type StatusCaptura = 'aguardando_envio' | 'na_fila' | 'processando' | 'revisao' | 'publicado' | 'erro' | 'cancelado';
export const ROTULO_STATUS_CAPTURA: Record<StatusCaptura, string> = {
  aguardando_envio: 'Aguardando envio',
  na_fila: 'Na fila',
  processando: 'Processando (GPU)',
  revisao: 'Pronta para revisão',
  publicado: 'Publicada',
  erro: 'Precisa de atenção',
  cancelado: 'Cancelada',
};

export interface Captura {
  id: string;
  projetoId: string;
  nome: string;
  status: StatusCaptura;
  mensagem: string | null;
  detalhes: string[];
  avisos: string[];
  metricas: { psnr?: number; gaussianas?: number; rostosDesfocados?: number; fotos?: number; registradas?: number; tempos_s?: Record<string, number> };
  tentativas: number;
  splatArquivoId: string | null;
  origem: 'fotos' | 'video';
  arquivoNome: string;
  criadoEm: string;
}

export interface Arquivo {
  id: string;
  nome: string;
  tipo: TipoArquivo;
  status: 'aguardando_envio' | 'verificando' | 'pronto' | 'rejeitado';
  motivoRejeicao: string | null;
  tamanho: number;
  verificadoAntivirus: boolean;
  criadoEm: string;
}

export type CategoriaPoi = 'escola' | 'saude' | 'mercado' | 'farmacia' | 'transporte' | 'parque' | 'outro';
export const ROTULO_CATEGORIA: Record<CategoriaPoi, string> = {
  escola: 'Escola',
  saude: 'Saúde',
  mercado: 'Mercado',
  farmacia: 'Farmácia',
  transporte: 'Transporte',
  parque: 'Parque',
  outro: 'Outro',
};

export interface Poi {
  id: string;
  categoria: CategoriaPoi;
  nome: string;
  origem: 'osm' | 'manual';
  distanciaM: number;
  minutosAPe: number;
}

export const tamanhoLegivel = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

// ------------------------------------------------------------------ vendas
export type StatusLink = 'ativo' | 'vencido' | 'revogado';
export interface LinkCliente {
  id: string;
  titulo: string | null;
  expiraEm: string;
  revogadoEm: string | null;
  criadoEm: string;
  criadoPor: { id: string; nome: string };
  status: StatusLink;
  visitas: number;
  leads: number;
}

export type StatusLead = 'novo' | 'em_contato' | 'convertido' | 'descartado';
export const STATUS_LEAD: readonly StatusLead[] = ['novo', 'em_contato', 'convertido', 'descartado'];
export const ROTULO_STATUS_LEAD: Record<StatusLead, string> = {
  novo: 'Novo',
  em_contato: 'Em contato',
  convertido: 'Virou venda',
  descartado: 'Descartado',
};
export interface Lead {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  mensagem: string | null;
  status: StatusLead;
  criadoEm: string;
  unidade: string | null;
  predio: string;
  predioId: string;
  projeto: string;
  projetoId: string;
  consultora: string;
  link: string | null;
}

export interface Numeros {
  dias: number;
  visitas: number;
  interiores: number;
  tempoMedioS: number | null;
  leads: number;
  conversao: number;
  unidades: Array<{ id: string; codigo: string; vistas: number; favoritos: number }>;
  porConsultora: Array<{ id: string; nome: string; links: number; visitas: number; leads: number }>;
}

/** O que o portal público recebe pelo token do link (sem login). */
export interface Portal {
  empresa: { nome: string };
  consultora: { nome: string };
  projeto: { id: string; nome: string; descricao: string | null; cidade: string | null; uf: string | null; lat: number | null; lon: number | null; rotacaoGraus: number };
  predio: { id: string; nome: string };
  andares: Array<{ numero: number; nome: string }>;
  unidades: Array<{ id: string; codigo: string; andar: number; status: StatusUnidade; preco: number | null; meshNodeId: string | null; tipologia: string | null; areaM2: number | null; quartos: number | null }>;
  modeloUrl: string | null;
  interiores: Array<{ id: string; nome: string }>;
  /** Transmissão do status das unidades ao vivo (EventSource direto na API). */
  aoVivoUrl: string;
}
