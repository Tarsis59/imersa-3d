'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** Atualização da página em andamento (de qualquer componente): duas ao mesmo tempo uma cancela a outra. */
let emAndamento = false;

/**
 * Enquanto `ativo` (algo na fila ou processando), atualiza a página `intervaloMs` depois que a atualização anterior
 * TERMINOU. Com setInterval, numa página que leva mais que o intervalo para montar (API grátis longe do banco),
 * cada atualização cancelava a anterior e a tela nunca mudava. Vários componentes na mesma página se revezam.
 */
export function useAtualizarEnquanto(ativo: boolean, intervaloMs: number): void {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  // muda junto com a atualização (dentro da transição): garante a próxima volta mesmo se nada mais mudar
  const [volta, setVolta] = useState(0);
  const dono = useRef(false);

  useEffect(() => {
    if (!pendente && dono.current) {
      dono.current = false;
      emAndamento = false;
    }
    if (!ativo || pendente) return;
    const t = setTimeout(() => {
      if (emAndamento) return setVolta((v) => v + 1); // outro componente está atualizando: espera mais uma volta
      emAndamento = true;
      dono.current = true;
      iniciar(() => {
        router.refresh();
        setVolta((v) => v + 1);
      });
    }, intervaloMs);
    return () => clearTimeout(t);
  }, [ativo, pendente, volta, intervaloMs, router]);

  useEffect(
    () => () => {
      if (dono.current) emAndamento = false;
    },
    [],
  );
}
