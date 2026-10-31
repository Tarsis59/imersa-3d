'use client';
import { useActionState } from 'react';
import { aceitarConvite, type EstadoAceite } from '../actions';
import { Aviso, Botao, Campo } from '@/components/ui';

export function FormAceite({ token, temConta }: { token: string; temConta: boolean }) {
  const [estado, acao, pendente] = useActionState<EstadoAceite, FormData>(aceitarConvite, {});
  return (
    <form action={acao} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      {!temConta && <Campo id="nome" name="nome" rotulo="Seu nome" required minLength={2} autoComplete="name" />}
      <Campo
        id="senha-convite"
        name="senha"
        type="password"
        rotulo={temConta ? 'Senha da sua conta' : 'Crie uma senha'}
        minLength={10}
        required
        autoComplete={temConta ? 'current-password' : 'new-password'}
      />
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      <Botao type="submit" disabled={pendente}>
        Aceitar convite
      </Botao>
    </form>
  );
}
