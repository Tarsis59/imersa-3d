'use client';
import { useEffect, useRef, useState } from 'react';
import { Botao } from '@/components/ui';

/** Quanto tempo segurar 3 dedos na tela para abrir o modo corretor. */
const SEGURAR_MS = 3_000;

/**
 * Modo corretor escondido do estande (Plano 12b, item 10): 3 dedos na tela por 3 s (ou Ctrl+Alt+C no teclado)
 * abre um painel discreto para esconder ou mostrar os preços e atualizar os dados, sem sair do estande. O visitante
 * não acha o painel por acaso. A escolha dos preços fica guardada neste aparelho.
 */
export function useModoCorretor(token: string) {
  const chave = `imersa:estande:${token}:precos-ocultos`;
  const [aberto, setAberto] = useState(false);
  const [precosOcultos, setPrecosOcultos] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      setPrecosOcultos(localStorage.getItem(chave) === '1');
    } catch {
      // sem armazenamento: começa mostrando os preços
    }
  }, [chave]);

  useEffect(() => {
    const cancelar = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const aoTocar = (e: TouchEvent) => {
      if (e.touches.length >= 3) {
        if (!timer.current) timer.current = setTimeout(() => setAberto(true), SEGURAR_MS);
      } else cancelar();
    };
    const aoSoltar = (e: TouchEvent) => {
      if (e.touches.length < 3) cancelar();
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'c') setAberto(true);
    };
    window.addEventListener('touchstart', aoTocar, { passive: true });
    window.addEventListener('touchend', aoSoltar, { passive: true });
    window.addEventListener('touchcancel', cancelar, { passive: true });
    window.addEventListener('keydown', aoTeclar);
    return () => {
      cancelar();
      window.removeEventListener('touchstart', aoTocar);
      window.removeEventListener('touchend', aoSoltar);
      window.removeEventListener('touchcancel', cancelar);
      window.removeEventListener('keydown', aoTeclar);
    };
  }, []);

  const alternarPrecos = () => {
    const novo = !precosOcultos;
    setPrecosOcultos(novo);
    try {
      localStorage.setItem(chave, novo ? '1' : '0');
    } catch {
      // sem armazenamento: vale até recarregar
    }
  };
  return { aberto, fechar: () => setAberto(false), precosOcultos, alternarPrecos };
}

export function PainelCorretor({ precosOcultos, alternarPrecos, fechar }: { precosOcultos: boolean; alternarPrecos: () => void; fechar: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="titulo-corretor" data-testid="modo-corretor" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="grid w-full max-w-sm gap-4 rounded-2xl border border-borda bg-superficie p-6 text-base">
        <h2 id="titulo-corretor" className="text-xl font-semibold">
          Modo corretor
        </h2>
        <p className="text-sm text-suave">Só para a equipe. O visitante não vê este painel.</p>
        <Botao type="button" aria-pressed={precosOcultos} onClick={alternarPrecos} className="min-h-14">
          {precosOcultos ? 'Mostrar os preços' : 'Esconder os preços'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={() => window.location.reload()} className="min-h-14">
          Atualizar os dados
        </Botao>
        <Botao type="button" variante="secundario" onClick={fechar} className="min-h-14">
          Fechar
        </Botao>
      </div>
    </div>
  );
}
