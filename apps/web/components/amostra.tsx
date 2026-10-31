'use client';
import { useEffect, useRef } from 'react';
import { desenharPadrao, type Acabamento, type Contexto2D } from '@imersa/viewer';

/** Amostra do acabamento desenhada pelo mesmo código da textura do 3D (o que a cliente vê aqui é o que vai na parede). */
export function Amostra({ acabamento, tamanho = 40 }: { acabamento: Pick<Acabamento, 'padrao' | 'cor' | 'cor2'>; tamanho?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { padrao, cor, cor2 } = acabamento;
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    // repetição desenhada em 2× para a amostra ficar nítida
    desenharPadrao(ctx as unknown as Contexto2D, tamanho * 2, { padrao, cor, cor2: cor2 ?? null });
  }, [padrao, cor, cor2, tamanho]);
  return <canvas ref={ref} width={tamanho * 2} height={tamanho * 2} style={{ width: tamanho, height: tamanho }} className="shrink-0 rounded border border-borda" aria-hidden />;
}
