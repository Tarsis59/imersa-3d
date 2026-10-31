'use client';
import { Botao } from '@/components/ui';

export function Imprimir() {
  return (
    <Botao type="button" variante="secundario" onClick={() => window.print()}>
      Imprimir ou salvar em PDF
    </Botao>
  );
}
