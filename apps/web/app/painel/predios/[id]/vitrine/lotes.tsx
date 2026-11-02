'use client';
import { useMemo, useState } from 'react';
import { Botao, Cartao } from '@/components/ui';
import { brl, COR_STATUS, ROTULO_STATUS, STATUS_UNIDADE, type StatusUnidade } from '@/lib/tipos';
import { FalarComCorretor } from './falar-corretor';

export interface LoteVitrine {
  id: string;
  quadra: string;
  numero: string;
  areaM2: number;
  frenteM: number | null;
  fundoM: number | null;
  preco: number | null;
  status: StatusUnidade;
  contorno: Array<[number, number]>;
  /** Para onde a frente está virada (Plano 12d, item 6). */
  orientacao: { anguloGraus: number; rotulo: string; dica: string } | null;
  /** Distância a pé até o clube (ou o ponto de lazer mais perto); `aproximado` = linha reta × 1,3 (sem ruas). */
  clube: { metros: number; aproximado: boolean } | null;
}
export interface FiltroLotes {
  precoMax: number | null;
  areaMin: number | null;
  quadras: ReadonlySet<string>;
  status: ReadonlySet<StatusUnidade>;
}
export const FILTRO_LOTES_VAZIO: FiltroLotes = { precoMax: null, areaMin: null, quadras: new Set(), status: new Set() };

/** Quem passa no buscador de lotes (preço, área, quadras e situação; vazio = sem esse filtro). */
export function filtrarLotes(lotes: readonly LoteVitrine[], f: FiltroLotes): Set<string> {
  return new Set(
    lotes
      .filter(
        (l) =>
          (f.precoMax === null || (l.preco !== null && l.preco <= f.precoMax)) &&
          (f.areaMin === null || l.areaM2 >= f.areaMin) &&
          (!f.quadras.size || f.quadras.has(l.quadra)) &&
          (!f.status.size || f.status.has(l.status)),
      )
      .map((l) => l.id),
  );
}

const m2 = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m²`;
const m = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m`);

/**
 * Buscador de lotes (Plano 12d, como no vídeo do loteamento): preço máximo, área mínima, grade de quadras e
 * situação; Ocultar (só os filtrados) e Limpar. Tocar num lote (no 3D ou na lista) abre o card dele.
 */
export function CartaoLotes({
  lotes,
  filtro,
  aoFiltrar,
  selecionado,
  aoSelecionar,
  corretor,
  vistaLote,
  aoVerDaqui,
  casaModeloLote,
  aoCasaModelo,
}: {
  lotes: readonly LoteVitrine[];
  filtro: FiltroLotes;
  aoFiltrar: (f: FiltroLotes) => void;
  selecionado: string | null;
  aoSelecionar: (id: string | null) => void;
  corretor: { nome: string; whatsapp: string; empreendimento: string } | null;
  /** "Ver daqui" (Plano 12d, item 11): qual lote está com a câmera na calçada, se algum. */
  vistaLote?: string | null;
  aoVerDaqui?: (id: string) => void;
  /** Casa-modelo no lote (Plano 12d, item 9): qual lote está com a casa, se algum. */
  casaModeloLote?: string | null;
  aoCasaModelo?: (id: string) => void;
}) {
  const quadras = useMemo(() => [...new Set(lotes.map((l) => l.quadra))], [lotes]);
  const passam = useMemo(() => filtrarLotes(lotes, filtro), [lotes, filtro]);
  const [preco, setPreco] = useState(filtro.precoMax === null ? '' : String(filtro.precoMax));
  const [area, setArea] = useState(filtro.areaMin === null ? '' : String(filtro.areaMin));
  const lote = lotes.find((l) => l.id === selecionado) ?? null;
  const alternar = <T,>(conjunto: ReadonlySet<T>, v: T) => {
    const n = new Set(conjunto);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };
  const lista = lotes.filter((l) => passam.has(l.id));
  return (
    <>
      {lote && (
        <Cartao titulo={`Lote ${lote.numero} · Quadra ${lote.quadra}`} id="lote-selecionado">
          <div className="grid gap-3 text-sm" data-testid="lote-selecionado">
            <span className={`w-fit rounded px-2 py-0.5 text-xs font-semibold ${COR_STATUS[lote.status]}`}>{ROTULO_STATUS[lote.status]}</span>
            {corretor && <FalarComCorretor numero={corretor.whatsapp} nomeCorretor={corretor.nome} empreendimento={corretor.empreendimento} unidade={`lote ${lote.numero} da quadra ${lote.quadra}`} />}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-suave">Área</dt>
              <dd>{m2(lote.areaM2)}</dd>
              <dt className="text-suave">Frente × fundo</dt>
              <dd>
                {m(lote.frenteM)} × {m(lote.fundoM)}
              </dd>
              <dt className="text-suave">Preço</dt>
              <dd>{brl(lote.preco)}</dd>
              {lote.orientacao && (
                <>
                  <dt className="text-suave">Frente para</dt>
                  <dd>
                    {lote.orientacao.rotulo} <span className="text-suave">({lote.orientacao.dica})</span>
                  </dd>
                </>
              )}
              {lote.clube && (
                <>
                  <dt className="text-suave">Até o clube</dt>
                  <dd>
                    {lote.clube.metros.toLocaleString('pt-BR')} m a pé{lote.clube.aproximado ? ' (aprox.)' : ''}
                  </dd>
                </>
              )}
            </dl>
            <p className="text-xs text-suave">Medidas calculadas do projeto de parcelamento. Imagens meramente ilustrativas.</p>
            <div className="flex flex-wrap gap-2">
              {aoVerDaqui && (
                <Botao type="button" variante="secundario" data-testid="ver-daqui" aria-pressed={vistaLote === lote.id} onClick={() => aoVerDaqui(lote.id)}>
                  Ver daqui
                </Botao>
              )}
              {aoCasaModelo && (
                <Botao type="button" variante="secundario" data-testid="casa-modelo" aria-pressed={casaModeloLote === lote.id} onClick={() => aoCasaModelo(lote.id)}>
                  {casaModeloLote === lote.id ? 'Tirar a casa-modelo' : 'Casa-modelo'}
                </Botao>
              )}
              <Botao type="button" variante="secundario" onClick={() => aoSelecionar(null)}>
                Fechar o lote
              </Botao>
            </div>
          </div>
        </Cartao>
      )}
      <Cartao titulo="Buscar lotes" id="secao-lotes">
        <div className="grid gap-4 text-sm" data-testid="buscador-lotes">
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1" htmlFor="lote-preco">
              <span className="font-medium">Preço máximo (R$)</span>
              <input id="lote-preco" inputMode="numeric" value={preco} onChange={(e) => setPreco(e.target.value.replace(/\D/g, ''))} onBlur={() => aoFiltrar({ ...filtro, precoMax: preco ? Number(preco) : null })} className="rounded-lg border border-borda bg-superficie px-3 py-2" />
            </label>
            <label className="grid gap-1" htmlFor="lote-area">
              <span className="font-medium">Área mínima (m²)</span>
              <input id="lote-area" inputMode="numeric" value={area} onChange={(e) => setArea(e.target.value.replace(/\D/g, ''))} onBlur={() => aoFiltrar({ ...filtro, areaMin: area ? Number(area) : null })} className="rounded-lg border border-borda bg-superficie px-3 py-2" />
            </label>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-medium">Quadras</legend>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8" role="group" aria-label="Quadras">
              {quadras.map((q) => (
                <button key={q} type="button" aria-pressed={filtro.quadras.has(q)} onClick={() => aoFiltrar({ ...filtro, quadras: alternar(filtro.quadras, q) })} className={`min-h-9 rounded-md border text-xs font-semibold tabular-nums ${filtro.quadras.has(q) ? 'border-acento bg-acento text-acento-texto' : 'border-borda hover:bg-fundo'}`}>
                  {q}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 w-full font-medium">Situação</legend>
            {STATUS_UNIDADE.map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="checkbox" checked={filtro.status.has(s)} onChange={() => aoFiltrar({ ...filtro, status: alternar(filtro.status, s) })} />
                {ROTULO_STATUS[s]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p data-testid="contagem-lotes" className="text-suave">
              {passam.size} de {lotes.length} lotes
            </p>
            <Botao
              type="button"
              variante="secundario"
              onClick={() => {
                setPreco('');
                setArea('');
                aoFiltrar(FILTRO_LOTES_VAZIO);
              }}
            >
              Limpar
            </Botao>
          </div>
          <ul className="grid max-h-64 gap-1 overflow-y-auto" data-testid="lista-lotes">
            {lista.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => aoSelecionar(l.id)} className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left hover:bg-fundo ${l.id === selecionado ? 'border-acento' : 'border-borda'}`}>
                  <span>
                    <b>Q{l.quadra} · L{l.numero}</b> <span className="text-suave">{m2(l.areaM2)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{brl(l.preco)}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${COR_STATUS[l.status]}`}>{ROTULO_STATUS[l.status]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Cartao>
    </>
  );
}
