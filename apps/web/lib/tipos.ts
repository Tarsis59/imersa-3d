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

export interface Projeto {
  id: string;
  nome: string;
  criado_em: string;
}

export const ehGestao = (papel: Me['papel']) => papel === 'admin' || papel === 'super_admin';
