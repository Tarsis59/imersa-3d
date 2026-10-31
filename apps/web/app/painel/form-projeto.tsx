'use client';
import { useActionState } from 'react';
import { criarProjeto, type EstadoForm } from './actions';
import { Aviso, Botao, Campo } from '@/components/ui';

export function FormProjeto() {
  const [estado, acao, pendente] = useActionState<EstadoForm, FormData>(criarProjeto, {});
  return (
    <form action={acao} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
      <Campo id="nome-projeto" name="nome" rotulo="Nome do projeto" minLength={2} maxLength={120} required />
      <Botao type="submit" disabled={pendente}>
        Criar projeto
      </Botao>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.ok && <Aviso tipo="sucesso">{estado.ok}</Aviso>}
    </form>
  );
}
