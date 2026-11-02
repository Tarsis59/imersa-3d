'use client';
import { useEffect, useMemo, useState } from 'react';
import { Botao, Cartao } from '@/components/ui';
import { ROTULO_CATEGORIA, type CategoriaPoi } from '@/lib/tipos';

export interface PontoProximo {
  id: string;
  categoria: CategoriaPoi;
  nome: string;
  distanciaM: number;
  caminhoM: number | null;
  minutosAPe: number;
}
export interface RotaAPe {
  metros: number;
  minutosAPe: number;
  pontos: Array<[number, number]>;
}
/** De onde a Vitrine tira os pontos próximos e a rota (painel com sessão; link do cliente e estande pelo token). */
export interface FonteProximidades {
  listar: () => Promise<PontoProximo[] | null>;
  rota: (poiId: string) => Promise<RotaAPe | null>;
}

const metros = (m: number) => (m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : `${m} m`);

/**
 * "O que há perto" (Plano 12a item 11 e 12b item 5, como nos vídeos 1 e 3): escolas, mercados, metrô com o tempo a
 * pé pelas ruas, busca por nome e filtro por tipo; tocar desenha a rota no chão e a câmera enquadra o caminho.
 */
export function CartaoProximidades({ fonte, pronto, desenhar }: { fonte: FonteProximidades; pronto: boolean; desenhar: (pontos: Array<[number, number]> | null) => boolean }) {
  const [pontos, setPontos] = useState<PontoProximo[] | null>(null);
  const [tipo, setTipo] = useState<CategoriaPoi | 'todos'>('todos');
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!pronto) return;
    let vivo = true;
    void fonte
      .listar()
      .then((p) => vivo && setPontos(p ?? []))
      .catch(() => vivo && setPontos([]));
    return () => {
      vivo = false;
    };
  }, [fonte, pronto]);

  const tipos = useMemo(() => [...new Set((pontos ?? []).map((p) => p.categoria))], [pontos]);
  const termo = busca.trim().toLowerCase();
  const lista = (pontos ?? []).filter((p) => (tipo === 'todos' || p.categoria === tipo) && (!termo || p.nome.toLowerCase().includes(termo)));

  async function escolher(p: PontoProximo) {
    setAviso(null);
    if (escolhido === p.id) {
      desenhar(null);
      return setEscolhido(null);
    }
    setEscolhido(p.id);
    const r = await fonte.rota(p.id).catch(() => null);
    if (!r || !desenhar(r.pontos)) {
      desenhar(null);
      setAviso(`Sem o desenho das ruas aqui: ${p.nome} fica a ${metros(p.distanciaM)} em linha reta.`);
    }
  }

  if (pontos !== null && pontos.length === 0) return null;
  return (
    <Cartao titulo="O que há perto" id="secao-entorno">
      {pontos === null ? (
        <p className="text-sm text-suave">Buscando escolas, mercados e transporte…</p>
      ) : (
        <div className="grid gap-3 text-sm" data-testid="proximidades">
          <label htmlFor="busca-ponto" className="grid gap-1">
            <span className="sr-only">Buscar lugar próximo</span>
            <input id="busca-ponto" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome (ex.: metrô)" className="rounded-lg border border-borda bg-superficie px-3 py-2" />
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de lugar">
            {(['todos', ...tipos] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tipo === t}
                onClick={() => setTipo(t)}
                className={`min-h-9 rounded-full border px-3 text-xs font-medium ${tipo === t ? 'border-acento bg-acento text-acento-texto' : 'border-borda hover:bg-fundo'}`}
              >
                {t === 'todos' ? 'Todos' : ROTULO_CATEGORIA[t]}
              </button>
            ))}
          </div>
          <ul className="grid max-h-64 gap-1 overflow-y-auto">
            {lista.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={escolhido === p.id}
                  onClick={() => void escolher(p)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left hover:bg-fundo ${escolhido === p.id ? 'border-acento' : 'border-borda'}`}
                >
                  <span className="grid">
                    <span className="font-medium">{p.nome}</span>
                    <span className="text-xs text-suave">{ROTULO_CATEGORIA[p.categoria]}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums">
                    <b>{p.minutosAPe} min</b> a pé
                    <br />
                    {metros(p.caminhoM ?? p.distanciaM)}
                  </span>
                </button>
              </li>
            ))}
            {lista.length === 0 && <li className="text-suave">Nada com esse nome por perto.</li>}
          </ul>
          {aviso && <p className="text-suave">{aviso}</p>}
          {escolhido && (
            <Botao type="button" variante="secundario" onClick={() => void escolher(lista.find((p) => p.id === escolhido) ?? (pontos.find((p) => p.id === escolhido) as PontoProximo))}>
              Apagar a rota
            </Botao>
          )}
        </div>
      )}
    </Cartao>
  );
}
