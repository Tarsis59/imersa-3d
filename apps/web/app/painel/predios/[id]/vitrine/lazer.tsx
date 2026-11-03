'use client';
import { useState } from 'react';
import { Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { CATEGORIAS_LAZER, GRUPOS_LAZER, ROTULO_GRUPO, ROTULO_LAZER, type CategoriaLazer, type GrupoLazer, type ItemLazer } from '@/lib/tipos';
import type { NovoLazer } from './actions';
import { Lightbox, MiniaturaFoto, type FotoGaleria } from './galeria';

export const ICONE_LAZER: Record<CategoriaLazer, string> = {
  piscina: '🏊',
  academia: '🏋️',
  salao_festas: '🎉',
  churrasqueira: '🍖',
  playground: '🛝',
  quadra: '🏀',
  espaco_gourmet: '🍷',
  brinquedoteca: '🧸',
  coworking: '💻',
  pet: '🐾',
  jardim: '🌳',
  outro: '📍',
};
export const rotuloDoPonto = (l: ItemLazer) => `${ICONE_LAZER[l.categoria]} ${l.nome}`;

/** Tempo em cada ponto no tour automático: o tour inteiro em ~2 min, entre 8 e 20 s por ponto. */
export const passoDoTourMs = (pontos: number) => Math.round(Math.min(20_000, Math.max(8_000, 120_000 / Math.max(1, pontos))));

export interface EstadoTour {
  indice: number;
  vistos: string[];
  completo: boolean;
}

/** Cartão do lazer: os pontos (tocar voa até lá), o tour e, para a gestão, marcar e remover pontos. */
export function CartaoLazer({
  itens,
  pronto,
  tour,
  aoIr,
  aoComecarTour,
  gerir,
  marcando,
  aoMarcar,
  aoCancelarMarcacao,
  aoRemover,
  erro,
  fotosDisponiveis = [],
  aoPasseio3D,
}: {
  itens: ItemLazer[];
  pronto: boolean;
  tour: EstadoTour | null;
  aoIr: (id: string) => void;
  aoComecarTour: () => void;
  gerir: boolean;
  marcando: boolean;
  aoMarcar: (d: Omit<NovoLazer, 'x' | 'y' | 'z'>) => void;
  aoCancelarMarcacao: () => void;
  aoRemover: (id: string) => void;
  erro: string | null;
  /** Fotos já enviadas no projeto, para a gestão escolher as da ficha deste espaço (Plano 12b, item 6). */
  fotosDisponiveis?: FotoGaleria[];
  /** "Passeio 3D" (Plano 12d, item 7): põe o boneco no chão, em 1ª pessoa, naquele ponto. */
  aoPasseio3D?: (id: string) => void;
}) {
  const [categoria, setCategoria] = useState<CategoriaLazer>('piscina');
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [fotosEscolhidas, setFotosEscolhidas] = useState<string[]>([]);
  // menu por categoria (Plano 12d, item 7): Lazer, Sociais, Gastronomia, Beach Sports, Pet; "Todos" sem filtro
  const [grupo, setGrupo] = useState<GrupoLazer | null>(null);
  const gruposComItem = GRUPOS_LAZER.filter((g) => itens.some((l) => l.grupo === g));
  const itensDoGrupo = grupo ? itens.filter((l) => l.grupo === grupo) : itens;
  if (!itens.length && !gerir) return null;
  return (
    <Cartao titulo="Lazer">
      <div className="grid gap-3 text-sm" data-testid="lazer">
        {itens.length > 0 && (
          <>
            <Botao type="button" disabled={!pronto || (tour !== null && !tour.completo)} onClick={aoComecarTour}>
              Conheça o lazer em 2 min
            </Botao>
            {gruposComItem.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categorias do lazer" data-testid="categorias-lazer">
                <button type="button" aria-pressed={grupo === null} onClick={() => setGrupo(null)} className={`min-h-8 rounded-full border px-3 text-xs font-semibold ${grupo === null ? 'border-acento bg-acento text-acento-texto' : 'border-borda hover:bg-fundo'}`}>
                  Todos
                </button>
                {gruposComItem.map((g) => (
                  <button key={g} type="button" aria-pressed={grupo === g} onClick={() => setGrupo(g)} className={`min-h-8 rounded-full border px-3 text-xs font-semibold ${grupo === g ? 'border-acento bg-acento text-acento-texto' : 'border-borda hover:bg-fundo'}`}>
                    {ROTULO_GRUPO[g]}
                  </button>
                ))}
              </div>
            )}
            <ul className="grid gap-1" data-testid="lista-lazer">
              {itensDoGrupo.map((l) => {
                const visto = tour?.vistos.includes(l.id) ?? false;
                return (
                  <li key={l.id} className="flex items-center gap-2">
                    <button type="button" disabled={!pronto} onClick={() => aoIr(l.id)} className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-fundo disabled:opacity-50">
                      {tour && (
                        <span aria-label={visto ? 'visto' : 'ainda não visto'} className={`grid h-5 w-5 place-items-center rounded-full border text-xs ${visto ? 'border-acento bg-acento text-acento-texto' : 'border-borda'}`}>
                          {visto ? '✓' : ''}
                        </span>
                      )}
                      <span>{rotuloDoPonto(l)}</span>
                    </button>
                    {aoPasseio3D && (
                      <button type="button" disabled={!pronto} onClick={() => aoPasseio3D(l.id)} className="rounded px-2 py-1 text-xs hover:bg-fundo disabled:opacity-50" data-testid="passeio-3d" aria-label={`Passeio 3D em ${l.nome}`}>
                        Passeio 3D
                      </button>
                    )}
                    {gerir && (
                      <button type="button" onClick={() => aoRemover(l.id)} className="rounded px-2 py-1 text-xs text-perigo hover:bg-fundo" aria-label={`Remover ${l.nome}`}>
                        Remover
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {gerir && (
          <fieldset className="grid gap-3 rounded-lg border border-borda p-3">
            <legend className="px-1 font-medium">Marcar um espaço do lazer</legend>
            <div className="grid gap-3">
              <Selecao id="lazer-categoria" rotulo="Tipo" value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaLazer)}>
                {CATEGORIAS_LAZER.map((c) => (
                  <option key={c} value={c}>
                    {ROTULO_LAZER[c]}
                  </option>
                ))}
              </Selecao>
              <Campo id="lazer-nome" rotulo="Nome do espaço" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder={ROTULO_LAZER[categoria]} />
              <Campo id="lazer-descricao" rotulo="Descrição (opcional)" value={descricao} maxLength={600} onChange={(e) => setDescricao(e.target.value)} />
              {fotosDisponiveis.length > 0 && (
                <fieldset className="grid gap-2" data-testid="lazer-fotos">
                  <legend className="text-sm font-medium">Fotos da ficha (até 12, opcional)</legend>
                  <div className="grid max-h-32 gap-1 overflow-y-auto">
                    {fotosDisponiveis.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={fotosEscolhidas.includes(f.id)}
                          disabled={!fotosEscolhidas.includes(f.id) && fotosEscolhidas.length >= 12}
                          onChange={(e) => setFotosEscolhidas((s) => (e.target.checked ? [...s, f.id] : s.filter((x) => x !== f.id)))}
                        />
                        {f.nome}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {marcando ? (
                <div className="grid gap-2">
                  <p role="status" className="text-acento">Clique no 3D, no chão ou no terraço, onde fica o espaço.</p>
                  <Botao type="button" variante="secundario" onClick={aoCancelarMarcacao}>
                    Cancelar
                  </Botao>
                </div>
              ) : (
                <Botao
                  type="button"
                  variante="secundario"
                  disabled={!pronto}
                  onClick={() => {
                    aoMarcar({ categoria, nome: nome.trim() || ROTULO_LAZER[categoria], descricao: descricao.trim() || null, fotos: fotosEscolhidas });
                    setNome('');
                    setDescricao('');
                    setFotosEscolhidas([]);
                  }}
                >
                  Marcar no 3D
                </Botao>
              )}
            </div>
          </fieldset>
        )}
        {erro && (
          <p role="alert" className="text-perigo">
            {erro}
          </p>
        )}
      </div>
    </Cartao>
  );
}

/** Por cima do 3D: o ponto em que a câmera está (no tour, com o progresso e os botões). */
export function PainelDoPonto({
  item,
  tour,
  total,
  aoProximo,
  aoEncerrar,
  resolverFoto,
}: {
  item: ItemLazer | null;
  tour: EstadoTour | null;
  total: number;
  aoProximo: () => void;
  aoEncerrar: () => void;
  /** Resolve o id do arquivo num link assinado (painel ou link do cliente): a ficha mostra as fotos (Plano 12b, item 6). */
  resolverFoto?: (id: string) => Promise<string | null>;
}) {
  const [fotoAberta, setFotoAberta] = useState<number | null>(null);
  if (tour?.completo)
    return (
      <div data-testid="tour-lazer" data-tour="completo" className="absolute inset-x-3 top-3 z-10 mx-auto grid max-w-md gap-2 rounded-2xl bg-slate-900/85 p-4 text-white shadow" role="status">
        <p className="text-lg font-semibold">Tour completo!</p>
        <p className="text-sm text-white/85">Você conheceu os {total} espaços do lazer.</p>
        <button type="button" onClick={aoEncerrar} className="justify-self-start rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-900">
          Voltar ao prédio
        </button>
      </div>
    );
  if (!item) return null;
  return (
    <div data-testid="tour-lazer" data-tour={tour ? 'andando' : 'ponto'} className="absolute inset-x-3 top-3 z-10 mx-auto grid max-w-md gap-2 rounded-2xl bg-slate-900/85 p-4 text-white shadow" role="status">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-lg font-semibold">{rotuloDoPonto(item)}</p>
        {tour && (
          <span className="shrink-0 text-xs text-white/75" data-testid="progresso-tour">
            {tour.indice + 1} de {total}
          </span>
        )}
      </div>
      {item.descricao && <p className="text-sm text-white/85">{item.descricao}</p>}
      {item.fotos.length > 0 && resolverFoto && (
        <div data-testid="ficha-fotos" className="flex gap-2 overflow-x-auto">
          {item.fotos.map((id, i) => (
            <button key={id} type="button" onClick={() => setFotoAberta(i)} aria-label={`Ver foto ${i + 1} de ${item.fotos.length} de ${item.nome}`} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg">
              <MiniaturaFoto foto={{ id, nome: `${item.nome} · foto ${i + 1}` }} resolverUrl={resolverFoto} />
            </button>
          ))}
        </div>
      )}
      {fotoAberta !== null && resolverFoto && (
        <Lightbox
          fotos={item.fotos.map((id, i) => ({ id, nome: `${item.nome} · foto ${i + 1}` }))}
          indiceInicial={fotoAberta}
          resolverUrl={resolverFoto}
          aoFechar={() => setFotoAberta(null)}
        />
      )}
      <div className="flex gap-2">
        {tour && (
          <button type="button" onClick={aoProximo} className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-900">
            {tour.indice + 1 >= total ? 'Concluir' : 'Próximo'}
          </button>
        )}
        <button type="button" onClick={aoEncerrar} className="rounded-full border border-white/50 px-4 py-1.5 text-sm">
          {tour ? 'Encerrar tour' : 'Fechar'}
        </button>
      </div>
    </div>
  );
}
