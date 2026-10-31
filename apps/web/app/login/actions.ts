'use server';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { lerSessao, limparSessao, salvarSessao, type Tokens } from '@/lib/sessao';

export interface EstadoLogin {
  erro?: string;
  precisaMfa?: boolean;
  email?: string;
  empresa?: string;
}

export async function entrar(_: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get('email') ?? '');
  const empresa = String(form.get('empresa') ?? '');
  const senha = String(form.get('senha') ?? '');
  const codigo = String(form.get('codigoMfa') ?? '');
  const r = await api<Partial<Tokens> & { erro?: string }>('/auth/login', {
    metodo: 'POST',
    corpo: { email, senha, empresa, ...(codigo ? { codigoMfa: codigo } : {}) },
  });
  if (r.status === 200 && r.dados.acesso && r.dados.refresh) {
    await salvarSessao({ acesso: r.dados.acesso, refresh: r.dados.refresh });
    redirect('/painel');
  }
  const codigoErro = r.dados.erro;
  return {
    erro: mensagem(r.status, r.dados),
    precisaMfa: codigoErro === 'mfa_obrigatorio' || codigoErro === 'mfa_invalido',
    email,
    empresa,
  };
}

export async function sair(): Promise<void> {
  const { refresh } = await lerSessao();
  if (refresh) await api('/auth/sair', { metodo: 'POST', corpo: { refresh } });
  await limparSessao();
  redirect('/login');
}
