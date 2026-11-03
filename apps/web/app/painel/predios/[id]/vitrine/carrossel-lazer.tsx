'use client';
import { useMemo, useRef } from 'react';
import type { ItemLazer } from '@/lib/tipos';
import { carrosselLazer, type CartaoCarrossel } from '@/lib/carrossel-lazer';
import { ICONE_LAZER } from './lazer';
import { MiniaturaFoto } from './galeria';

/**
 * Áreas comuns em 3D (Plano 12c, item 4): carrossel de cards, um por ponto do lazer, na ordem do tour. Desliza no
 * celular (scroll nativo), tem setas e aceita o teclado (← →). Tocar num card abre o splat do ambiente, o giro
 * 360° do prédio ou voa a câmera até o ponto, pelo que `carrosselLazer` decidiu para cada um.
 */
export function CarrosselAreasComuns({
  itens,
  interiores,
  temGiro360,
  pronto,
  resolverFoto,
  aoAbrirSplat,
  aoAbrirGiro360,
  aoVoarAoPonto,
}: {
  itens: ItemLazer[];
  interiores: Array<{ id: string; nome: string }>;
  temGiro360: boolean;
  pronto: boolean;
  resolverFoto?: (id: string) => Promise<string | null>;
  aoAbrirSplat: (interior: { id: string; nome: string }) => void;
  aoAbrirGiro360: () => void;
  aoVoarAoPonto: (id: string) => void;
}) {
  const cartoes = useMemo(() => carrosselLazer(itens, interiores, temGiro360), [itens, interiores, temGiro360]);
  const trilha = useRef<HTMLDivElement>(null);
  if (!cartoes.length) return null;

  const abrir = (c: CartaoCarrossel) => {
    const acao = c.acao;
    if (acao.tipo === 'splat') {
      const interior = interiores.find((i) => i.id === acao.interiorId);
      if (interior) aoAbrirSplat(interior);
    } else if (acao.tipo === 'giro360') aoAbrirGiro360();
    else aoVoarAoPonto(c.id);
  };

  const rolar = (sentido: 1 | -1) => {
    const el = trilha.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('[data-testid="carrossel-item"]');
    el.scrollBy({ left: sentido * (card?.offsetWidth ?? 200 + 12), behavior: 'smooth' });
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const proximo = i + (e.key === 'ArrowRight' ? 1 : -1);
    const alvo = trilha.current?.querySelectorAll<HTMLButtonElement>('[data-testid="carrossel-item"]')[proximo];
    alvo?.focus();
    alvo?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  return (
    <div className="grid gap-2" data-testid="carrossel-lazer">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Áreas comuns em 3D</span>
        <div className="flex gap-1">
          <button type="button" aria-label="Anterior" onClick={() => rolar(-1)} className="min-h-8 min-w-8 rounded-full border border-borda hover:bg-fundo">
            ‹
          </button>
          <button type="button" aria-label="Próxima" onClick={() => rolar(1)} className="min-h-8 min-w-8 rounded-full border border-borda hover:bg-fundo">
            ›
          </button>
        </div>
      </div>
      <div ref={trilha} className="flex gap-3 overflow-x-auto scroll-smooth pb-1 snap-x snap-mandatory" role="list">
        {cartoes.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="listitem"
            data-testid="carrossel-item"
            data-acao={c.acao.tipo}
            disabled={!pronto}
            onClick={() => abrir(c)}
            onKeyDown={(e) => aoTeclar(e, i)}
            className="grid w-36 shrink-0 snap-start gap-1 rounded-xl border border-borda bg-superficie p-2 text-left text-sm hover:bg-fundo disabled:opacity-50"
          >
            <span className="grid h-20 w-full place-items-center overflow-hidden rounded-lg bg-fundo text-3xl">
              {c.fotoId && resolverFoto ? <MiniaturaFoto foto={{ id: c.fotoId, nome: c.nome }} resolverUrl={resolverFoto} /> : ICONE_LAZER[c.categoria]}
            </span>
            <span className="truncate font-medium">{c.nome}</span>
            <span className="text-xs text-suave">{c.acao.tipo === 'splat' ? 'Interior real' : c.acao.tipo === 'giro360' ? 'Giro 360°' : 'Ir até lá'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
