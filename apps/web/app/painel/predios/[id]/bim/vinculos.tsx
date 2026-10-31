'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Aviso, Botao } from '@/components/ui';

export interface DadosVinculo {
  glbArquivoId: string;
  espacos: Array<{ guid: string; nome: string | null; nomeLongo: string | null; andar: string | null; areaM2: number | null }>;
  unidades: Array<{ id: string; codigo: string; andar: number; meshNodeId: string | null }>;
  sugestoes: Array<{ unidadeId: string; espacoGuid: string; motivo: 'codigo' | 'numero' }>;
}

const rotulo = (e: DadosVinculo['espacos'][number]) =>
  [e.nome, e.nomeLongo].filter(Boolean).join(' · ') + (e.andar ? ` (${e.andar})` : '') + (e.areaM2 ? ` · ${e.areaM2.toLocaleString('pt-BR')} m²` : '');

export function Vinculos({
  predioId,
  dados,
  salvar,
}: {
  predioId: string;
  dados: DadosVinculo;
  salvar: (v: Array<{ unidadeId: string; espacoGuid: string | null }>) => Promise<{ erro?: string; vinculadas?: number }>;
}) {
  const guids = new Set(dados.espacos.map((e) => e.guid));
  // começa pelo vínculo atual (se for deste modelo) ou pela sugestão automática
  const [escolha, setEscolha] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      dados.unidades.map((u) => [u.id, u.meshNodeId && guids.has(u.meshNodeId) ? u.meshNodeId : (dados.sugestoes.find((s) => s.unidadeId === u.id)?.espacoGuid ?? '')]),
    ),
  );
  const [resultado, setResultado] = useState<{ erro?: string; vinculadas?: number } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const usados = Object.values(escolha).filter(Boolean);
  const repetidos = new Set(usados.filter((g, i) => usados.indexOf(g) !== i));
  const automaticas = dados.sugestoes.length;

  return (
    <div className="grid gap-4 text-sm">
      <p className="text-suave">
        {dados.espacos.length} ambientes no modelo · {dados.unidades.length} unidades no prédio · {automaticas} {automaticas === 1 ? 'vínculo sugerido' : 'vínculos sugeridos'} automaticamente (código ou número igual).
      </p>
      <table className="w-full text-left" data-testid="tabela-vinculos">
        <thead className="text-suave">
          <tr>
            <th className="py-1 font-medium">Unidade</th>
            <th className="py-1 font-medium">Ambiente do BIM</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {dados.unidades.map((u) => (
            <tr key={u.id}>
              <td className="py-2 font-semibold">{u.codigo}</td>
              <td className="py-2">
                <label className="sr-only" htmlFor={`amb-${u.id}`}>
                  Ambiente da unidade {u.codigo}
                </label>
                <select
                  id={`amb-${u.id}`}
                  className={`w-full rounded-lg border bg-superficie px-2 py-1 ${repetidos.has(escolha[u.id] ?? '') ? 'border-perigo' : 'border-borda'}`}
                  value={escolha[u.id] ?? ''}
                  onChange={(e) => setEscolha({ ...escolha, [u.id]: e.target.value })}
                >
                  <option value="">Sem vínculo</option>
                  {dados.espacos.map((e) => (
                    <option key={e.guid} value={e.guid}>
                      {rotulo(e)}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {repetidos.size > 0 && <Aviso tipo="erro">Há ambientes escolhidos para mais de uma unidade (destacados em vermelho).</Aviso>}
      {resultado?.erro && <Aviso tipo="erro">{resultado.erro}</Aviso>}
      {resultado?.vinculadas !== undefined && (
        <Aviso tipo="sucesso">
          {resultado.vinculadas} unidades vinculadas e modelo ligado ao prédio.{' '}
          <Link href={`/painel/predios/${predioId}/vitrine`} className="font-semibold underline">
            Abrir Vitrine 3D
          </Link>
        </Aviso>
      )}
      <Botao
        type="button"
        className="w-fit"
        disabled={ocupado || repetidos.size > 0}
        onClick={() =>
          iniciar(async () => {
            setResultado(await salvar(dados.unidades.map((u) => ({ unidadeId: u.id, espacoGuid: escolha[u.id] || null }))));
          })
        }
      >
        Salvar vínculos e usar este modelo
      </Botao>
    </div>
  );
}
