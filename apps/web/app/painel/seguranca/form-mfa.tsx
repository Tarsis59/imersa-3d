'use client';
import { useActionState } from 'react';
import { confirmarMfa, gerarMfa, type EstadoForm, type EstadoMfa } from '../actions';
import { Aviso, Botao, Campo } from '@/components/ui';

export function FormMfa() {
  const [gerado, gerar, gerando] = useActionState<EstadoMfa, FormData>(gerarMfa, {});
  const [confirmacao, confirmar, confirmando] = useActionState<EstadoForm, FormData>(confirmarMfa, {});
  return (
    <div className="grid gap-4">
      {!gerado.segredo && (
        <form action={gerar}>
          <Botao type="submit" disabled={gerando}>
            Gerar código QR
          </Botao>
        </form>
      )}
      {gerado.erro && <Aviso tipo="erro">{gerado.erro}</Aviso>}
      {gerado.segredo && gerado.qr && (
        <>
          <p className="text-sm">1. Escaneie com o Google Authenticator, Microsoft Authenticator ou similar:</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL gerada no servidor */}
          <img src={gerado.qr} alt="Código QR para o aplicativo autenticador" width={220} height={220} className="rounded-lg bg-white p-2" />
          <p className="text-sm">
            Ou digite a chave: <code data-testid="segredo-mfa" className="rounded bg-fundo px-1 font-mono">{gerado.segredo}</code>
          </p>
          <form action={confirmar} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Campo id="codigo-mfa" name="codigo" rotulo="Código de 6 dígitos" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required />
            <Botao type="submit" disabled={confirmando}>
              Confirmar
            </Botao>
          </form>
          {confirmacao.erro && <Aviso tipo="erro">{confirmacao.erro}</Aviso>}
        </>
      )}
    </div>
  );
}
