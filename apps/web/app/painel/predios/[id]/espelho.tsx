'use client';
import { useActionState, useState } from 'react';
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { brl, COR_STATUS, ROTULO_STATUS, STATUS_UNIDADE, type Espelho } from '@/lib/tipos';
import type { EstadoStatus } from './actions';

export function EspelhoVendas({ espelho, mudarStatus }: { espelho: Espelho; mudarStatus: (e: EstadoStatus, f: FormData) => Promise<EstadoStatus> }) {
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);
  const [estado, enviar, pendente] = useActionState(mudarStatus, {});
  const todas = espelho.andares.flatMap((a) => a.unidades.map((u) => ({ ...u, andar: a.nome })));
  const sel = todas.find((u) => u.id === selecionadaId) ?? null;
  const maxPorAndar = Math.max(1, ...espelho.andares.map((a) => a.unidades.length));
  const mensagemDaSelecionada = sel && estado.unidadeId === sel.id ? estado : {};

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
      <Cartao titulo="Espelho de vendas">
        <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {STATUS_UNIDADE.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span className={`inline-block size-3 rounded-sm ${COR_STATUS[s]}`} aria-hidden />
              {ROTULO_STATUS[s]}
            </li>
          ))}
        </ul>
        {todas.length === 0 ? (
          <p className="text-suave">Este prédio ainda não tem unidades. Importe a planilha na página do empreendimento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-1.5" aria-label={`Espelho de vendas de ${espelho.predio.nome}`}>
              <tbody>
                {espelho.andares.map((a) => (
                  <tr key={a.id}>
                    <th scope="row" className="whitespace-nowrap pr-2 text-right text-sm font-medium text-suave">
                      {a.nome}
                    </th>
                    {Array.from({ length: maxPorAndar }, (_, i) => {
                      const u = a.unidades[i];
                      if (!u) return <td key={i} />;
                      const ativa = sel?.id === u.id;
                      return (
                        <td key={u.id}>
                          <button
                            type="button"
                            data-testid={`unidade-${u.codigo}`}
                            data-status={u.status}
                            aria-label={`Unidade ${u.codigo}, ${ROTULO_STATUS[u.status]}`}
                            aria-pressed={ativa}
                            onClick={() => setSelecionadaId(u.id)}
                            className={`min-h-11 min-w-16 rounded-lg px-2 text-sm font-semibold tabular-nums transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${COR_STATUS[u.status]} ${ativa ? 'ring-4 ring-acento ring-offset-2 ring-offset-superficie' : 'hover:opacity-85'}`}
                          >
                            {u.codigo}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <aside className="lg:sticky lg:top-6">
        {sel ? (
          <Cartao titulo={`Unidade ${sel.codigo}`}>
            <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-suave">Status</dt>
              <dd data-testid="status-selecionada">{ROTULO_STATUS[sel.status]}</dd>
              <dt className="text-suave">Andar</dt>
              <dd>{sel.andar}</dd>
              <dt className="text-suave">Tipologia</dt>
              <dd>{sel.tipologia ?? '—'}</dd>
              <dt className="text-suave">Área</dt>
              <dd className="tabular-nums">{sel.areaM2 !== null ? `${sel.areaM2.toLocaleString('pt-BR')} m²` : '—'}</dd>
              <dt className="text-suave">Quartos</dt>
              <dd className="tabular-nums">{sel.quartos ?? '—'}</dd>
              <dt className="text-suave">Preço</dt>
              <dd className="tabular-nums">{brl(sel.preco)}</dd>
            </dl>
            {sel.transicoes.length === 0 ? (
              <p className="text-sm text-suave">Seu papel não pode mudar o status desta unidade.</p>
            ) : (
              <form action={enviar} className="grid gap-3" key={sel.id}>
                <input type="hidden" name="unidadeId" value={sel.id} />
                <Selecao id="novo-status" name="status" rotulo="Novo status" defaultValue={sel.transicoes[0]}>
                  {sel.transicoes.map((s) => (
                    <option key={s} value={s}>
                      {ROTULO_STATUS[s]}
                    </option>
                  ))}
                </Selecao>
                <Campo
                  id="motivo"
                  name="motivo"
                  rotulo={sel.status === 'vendido' ? 'Motivo do distrato (obrigatório)' : 'Motivo (opcional)'}
                  maxLength={500}
                  required={sel.status === 'vendido'}
                />
                <Botao type="submit" disabled={pendente}>
                  {pendente ? 'Salvando…' : 'Mudar status'}
                </Botao>
              </form>
            )}
            <div className="mt-3">
              {mensagemDaSelecionada.erro && <Aviso tipo="erro">{mensagemDaSelecionada.erro}</Aviso>}
              {mensagemDaSelecionada.ok && <Aviso tipo="sucesso">{mensagemDaSelecionada.ok}</Aviso>}
            </div>
          </Cartao>
        ) : (
          <Cartao>
            <p className="text-sm text-suave">Toque numa unidade para ver os detalhes e mudar o status.</p>
          </Cartao>
        )}
      </aside>
    </div>
  );
}
