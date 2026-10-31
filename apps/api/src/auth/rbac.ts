export const PAPEIS = ['super_admin', 'admin', 'consultora', 'produtor', 'viewer'] as const;
export type Papel = (typeof PAPEIS)[number];

export type Acao =
  | 'projeto:ler'
  | 'projeto:criar'
  | 'membro:convidar'
  | 'auditoria:ler'
  | 'empreendimento:editar'
  | 'importacao:executar'
  | 'unidade:status'
  | 'captura:enviar'
  | 'captura:revisar'
  | 'link:criar'
  | 'lead:ler'
  | 'numeros:ler'
  | 'integracao:gerir'
  | 'catalogo:editar'
  | 'configuracao:salvar';

const TODOS: readonly Papel[] = PAPEIS;
const GESTAO: readonly Papel[] = ['super_admin', 'admin'];
const SENSIVEIS: readonly Acao[] = ['projeto:criar', 'membro:convidar', 'auditoria:ler', 'empreendimento:editar', 'importacao:executar', 'unidade:status', 'captura:revisar', 'lead:ler', 'integracao:gerir', 'catalogo:editar'];

const MATRIZ: Record<Acao, readonly Papel[]> = {
  'projeto:ler': TODOS,
  'projeto:criar': GESTAO,
  'membro:convidar': GESTAO,
  'auditoria:ler': GESTAO,
  'empreendimento:editar': GESTAO,
  'importacao:executar': GESTAO,
  // A regra fina (quem faz qual transição) fica em dominio/status.ts.
  'unidade:status': [...GESTAO, 'consultora'],
  // quem está no imóvel envia as fotos/vídeo; só a gestão publica o 3D
  'captura:enviar': [...GESTAO, 'consultora', 'produtor'],
  'captura:revisar': GESTAO,
  // vendas: a consultora gera links e atende os próprios leads; a gestão vê tudo (leads são dados pessoais: MFA)
  'link:criar': [...GESTAO, 'consultora'],
  'lead:ler': [...GESTAO, 'consultora'],
  'numeros:ler': [...GESTAO, 'consultora'],
  // chaves de API e webhooks dão acesso a todos os leads: só a gestão, com MFA
  'integracao:gerir': GESTAO,
  // configurador: o catálogo (materiais, móveis e preços) é da gestão; a consultora monta e salva a combinação com a cliente
  'catalogo:editar': GESTAO,
  'configuracao:salvar': [...GESTAO, 'consultora'],
};

export const pode = (papel: Papel, acao: Acao): boolean => MATRIZ[acao].includes(papel);

export const ehGestao = (papel: Papel): boolean => GESTAO.includes(papel);

/** Gestão só faz ação sensível com sessão que passou por MFA. */
export const exigeMfa = (papel: Papel, acao: Acao): boolean => GESTAO.includes(papel) && SENSIVEIS.includes(acao);
