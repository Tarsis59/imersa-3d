'use client';
import { useEffect, useRef, useState } from 'react';
import { Botao, Cartao, Selecao } from '@/components/ui';

export interface FotoGaleria {
  id: string;
  nome: string;
}

/** Miniatura que resolve o link assinado sozinha (cada foto é um arquivo com link que vence). */
export function MiniaturaFoto({ foto, resolverUrl, className = 'h-full w-full object-cover' }: { foto: FotoGaleria; resolverUrl: (id: string) => Promise<string | null>; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void resolverUrl(foto.id).then((u) => {
      if (vivo) setUrl(u);
    });
    return () => {
      vivo = false;
    };
  }, [foto.id, resolverUrl]);
  if (!url) return <div aria-hidden className="h-full w-full animate-pulse bg-borda" />;
  // eslint-disable-next-line @next/next/no-img-element -- link assinado de outro domínio, sem o loader do Next
  return <img src={url} alt={foto.nome} className={className} draggable={false} />;
}

/**
 * Tela cheia com contador, setas, deslizar no celular e teclado (Plano 12b, item 7; reaproveitada na ficha das
 * áreas comuns, item 6).
 */
export function Lightbox({
  fotos,
  indiceInicial,
  resolverUrl,
  aoFechar,
}: {
  fotos: FotoGaleria[];
  indiceInicial: number;
  resolverUrl: (id: string) => Promise<string | null>;
  aoFechar: () => void;
}) {
  const [indice, setIndice] = useState(indiceInicial);
  const raiz = useRef<HTMLDivElement>(null);
  const toqueX = useRef<number | null>(null);
  const total = fotos.length;

  useEffect(() => {
    const aoTeclado = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndice((i) => (i - 1 + total) % total);
      else if (e.key === 'ArrowRight') setIndice((i) => (i + 1) % total);
      else if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', aoTeclado);
    return () => window.removeEventListener('keydown', aoTeclado);
  }, [total, aoFechar]);

  const foto = fotos[Math.min(indice, total - 1)]!;
  return (
    <div
      ref={raiz}
      role="dialog"
      aria-modal="true"
      aria-label={`Foto: ${foto.nome}`}
      data-testid="galeria-lightbox"
      className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-3"
      onPointerDown={(e) => {
        toqueX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        if (toqueX.current === null) return;
        const dx = e.clientX - toqueX.current;
        toqueX.current = null;
        if (Math.abs(dx) < 40) return;
        setIndice((i) => (dx > 0 ? (i - 1 + total) % total : (i + 1) % total));
      }}
    >
      <button type="button" onClick={aoFechar} aria-label="Fechar" className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-xl text-white hover:bg-white/25">
        ✕
      </button>
      {typeof document !== 'undefined' && document.fullscreenEnabled && (
        <button
          type="button"
          onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : raiz.current?.requestFullscreen())}
          aria-label="Tela cheia"
          className="absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
        >
          ⛶
        </button>
      )}
      {total > 1 && (
        <button
          type="button"
          onClick={() => setIndice((i) => (i - 1 + total) % total)}
          aria-label="Foto anterior"
          className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
        >
          ‹
        </button>
      )}
      <div className="max-h-[85vh] max-w-full">
        <MiniaturaFoto foto={foto} resolverUrl={resolverUrl} className="max-h-[85vh] max-w-full select-none object-contain" />
      </div>
      {total > 1 && (
        <button
          type="button"
          onClick={() => setIndice((i) => (i + 1) % total)}
          aria-label="Próxima foto"
          className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25"
        >
          ›
        </button>
      )}
      <p data-testid="galeria-contador" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
        {indice + 1} de {total}
      </p>
    </div>
  );
}

/** Seção "Galeria" na Vitrine e no portal (Plano 12b, item 7): grade de miniaturas que abrem a tela cheia. */
export function CartaoGaleria({ fotos, resolverUrl }: { fotos: FotoGaleria[]; resolverUrl: (id: string) => Promise<string | null> }) {
  const [aberta, setAberta] = useState<number | null>(null);
  if (!fotos.length) return null;
  return (
    <Cartao id="secao-galeria" titulo={`Galeria · ${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'}`}>
      <div data-testid="galeria" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {fotos.map((f, i) => (
          <button key={f.id} type="button" onClick={() => setAberta(i)} aria-label={`Ver foto ${i + 1} de ${fotos.length}: ${f.nome}`} className="aspect-square overflow-hidden rounded-lg bg-fundo">
            <MiniaturaFoto foto={f} resolverUrl={resolverUrl} />
          </button>
        ))}
      </div>
      {aberta !== null && <Lightbox fotos={fotos} indiceInicial={aberta} resolverUrl={resolverUrl} aoFechar={() => setAberta(null)} />}
    </Cartao>
  );
}

/** Gestão (painel): escolhe quais fotos do projeto entram na galeria e a ordem (setas para cima/baixo). */
export function GestaoGaleria({
  disponiveis,
  atual,
  salvar,
}: {
  disponiveis: FotoGaleria[];
  atual: string[];
  salvar: (ids: string[]) => Promise<{ erro?: string }>;
}) {
  const [selecionados, setSelecionados] = useState<string[]>(atual);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mover = (id: string, delta: number) =>
    setSelecionados((s) => {
      const i = s.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const copia = [...s];
      [copia[i], copia[j]] = [copia[j]!, copia[i]!];
      return copia;
    });
  return (
    <fieldset className="grid gap-3 rounded-lg border border-borda p-3" data-testid="gestao-galeria">
      <legend className="px-1 font-medium">Galeria: fotos e ordem</legend>
      <ul className="grid gap-1" data-testid="galeria-selecionadas">
        {selecionados.map((id, i) => {
          const foto = disponiveis.find((d) => d.id === id);
          const nome = foto?.nome ?? id;
          return (
            <li key={id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-fundo">
              <span className="flex-1 truncate text-sm">{nome}</span>
              <button type="button" disabled={i === 0} onClick={() => mover(id, -1)} aria-label={`Mover ${nome} para cima`} className="rounded px-2 py-1 text-xs disabled:opacity-30">
                ↑
              </button>
              <button type="button" disabled={i === selecionados.length - 1} onClick={() => mover(id, 1)} aria-label={`Mover ${nome} para baixo`} className="rounded px-2 py-1 text-xs disabled:opacity-30">
                ↓
              </button>
              <button type="button" onClick={() => setSelecionados((s) => s.filter((x) => x !== id))} aria-label={`Remover ${nome} da galeria`} className="rounded px-2 py-1 text-xs text-perigo">
                Remover
              </button>
            </li>
          );
        })}
      </ul>
      {disponiveis.some((d) => !selecionados.includes(d.id)) && (
        <Selecao
          id="galeria-adicionar"
          rotulo="Adicionar foto do projeto"
          value=""
          onChange={(e) => {
            if (e.target.value) setSelecionados((s) => [...s, e.target.value]);
          }}
        >
          <option value="">Escolher…</option>
          {disponiveis
            .filter((d) => !selecionados.includes(d.id))
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
        </Selecao>
      )}
      <Botao
        type="button"
        disabled={salvando}
        onClick={async () => {
          setSalvando(true);
          setErro(null);
          const r = await salvar(selecionados);
          setSalvando(false);
          if (r.erro) setErro(r.erro);
        }}
      >
        {salvando ? 'Salvando…' : 'Salvar galeria'}
      </Botao>
      {erro && (
        <p role="alert" className="text-perigo">
          {erro}
        </p>
      )}
    </fieldset>
  );
}
