'use client';
import { useActionState } from 'react';
import { convidar, type EstadoConvite } from '../actions';
import { Aviso, Botao, Campo, Selecao } from '@/components/ui';

export function FormConvite() {
  const [estado, acao, pendente] = useActionState<EstadoConvite, FormData>(convidar, {});
  return (
    <form action={acao} className="grid gap-4">
      <Campo id="email-convite" name="email" type="email" rotulo="E-mail da pessoa" required />
      <Selecao id="papel-convite" name="papel" rotulo="Papel" defaultValue="consultora">
        <option value="consultora">Consultora</option>
        <option value="produtor">Produtor 3D</option>
        <option value="viewer">Somente leitura</option>
        <option value="admin">Administrador</option>
      </Selecao>
      <Botao type="submit" disabled={pendente}>
        Gerar convite
      </Botao>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.link && (
        <Aviso tipo="sucesso">
          {estado.ok}
          <code data-testid="link-convite" className="mt-2 block break-all rounded bg-fundo p-2 text-xs">
            {estado.link}
          </code>
        </Aviso>
      )}
    </form>
  );
}
