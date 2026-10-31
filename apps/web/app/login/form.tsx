'use client';
import { useActionState } from 'react';
import { entrar, type EstadoLogin } from './actions';
import { Aviso, Botao, Campo } from '@/components/ui';

export function FormLogin({ empresaInicial }: { empresaInicial?: string }) {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(entrar, { empresa: empresaInicial });
  return (
    <form action={acao} className="grid gap-4">
      {estado.erro && <Aviso tipo={estado.precisaMfa && !estado.erro.includes('inválido') ? 'info' : 'erro'}>{estado.erro}</Aviso>}
      <Campo id="empresa" name="empresa" rotulo="Empresa" placeholder="ex.: construtora-demo" defaultValue={estado.empresa} required autoComplete="organization" />
      <Campo id="email" name="email" type="email" rotulo="E-mail" defaultValue={estado.email} required autoComplete="email" />
      <Campo id="senha" name="senha" type="password" rotulo="Senha" required autoComplete="current-password" />
      {estado.precisaMfa && (
        <Campo id="codigoMfa" name="codigoMfa" rotulo="Código do autenticador" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required autoFocus />
      )}
      <Botao type="submit" disabled={pendente}>
        {pendente ? 'Entrando…' : 'Entrar'}
      </Botao>
    </form>
  );
}
