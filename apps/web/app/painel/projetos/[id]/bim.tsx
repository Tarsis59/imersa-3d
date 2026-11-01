'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAtualizarEnquanto } from '@/lib/atualizacao';
import { Aviso, Botao } from '@/components/ui';
import { tamanhoLegivel, type Arquivo, type ConversaoBim } from '@/lib/tipos';

const ROTULO = { na_fila: 'Na fila', processando: 'Convertendo…', pronto: 'Pronto', erro: 'Erro' } as const;
const COR = { na_fila: 'bg-slate-200 text-slate-800', processando: 'bg-sky-100 text-sky-900', pronto: 'bg-emerald-100 text-emerald-900', erro: 'bg-red-100 text-red-900' } as const;

/** Projeto BIM (IFC) → 3D otimizado com pavimentos e ambientes; depois, vínculo dos ambientes com as unidades de cada prédio. */
export function SecaoBim({
  ifcs,
  conversoes,
  predios,
  podeEditar,
  converter,
}: {
  ifcs: Arquivo[];
  conversoes: ConversaoBim[];
  predios: Array<{ id: string; nome: string }>;
  podeEditar: boolean;
  converter: (arquivoId: string) => Promise<{ erro?: string }>;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const andamento = conversoes.some((c) => c.status === 'na_fila' || c.status === 'processando');
  useAtualizarEnquanto(!!andamento, 4000);

  if (!ifcs.length) return <p className="text-sm text-suave">Envie o projeto em IFC (exportado do Revit, ArchiCAD, SketchUp etc.) em “Arquivos 3D e documentos”: ele vira 3D navegável com pavimentos e ambientes.</p>;
  return (
    <div className="grid gap-3">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <ul className="divide-y divide-borda text-sm" data-testid="lista-bim">
        {ifcs.map((a) => {
          const c = conversoes.find((x) => x.arquivoId === a.id);
          return (
            <li key={a.id} data-status-bim={c?.status ?? 'nenhuma'} className="grid gap-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{a.nome}</strong>
                {c ? (
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${COR[c.status]}`}>{ROTULO[c.status]}</span>
                ) : (
                  podeEditar && (
                    <Botao
                      type="button"
                      variante="secundario"
                      disabled={ocupado}
                      onClick={() =>
                        iniciar(async () => {
                          setErro(null);
                          const r = await converter(a.id);
                          if (r.erro) setErro(r.erro);
                          router.refresh();
                        })
                      }
                    >
                      Converter para 3D
                    </Botao>
                  )
                )}
              </div>
              {c?.status === 'erro' && <p className="text-perigo">{c.mensagem}</p>}
              {c?.status === 'pronto' && (
                <>
                  <p className="text-suave">
                    {c.andares} {c.andares === 1 ? 'pavimento' : 'pavimentos'} · {c.ambientes} ambientes · 3D otimizado: {tamanhoLegivel(c.bytes ?? 0)}
                    {c.bytesOriginal ? ` (${Math.round((1 - (c.bytes ?? 0) / c.bytesOriginal) * 100)}% menor)` : ''}
                  </p>
                  {podeEditar && (
                    <div className="flex flex-wrap gap-3">
                      {predios.map((p) => (
                        <Link key={p.id} href={`/painel/predios/${p.id}/bim?conversao=${c.id}`} className="font-medium underline">
                          Vincular ambientes: {p.nome}
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
