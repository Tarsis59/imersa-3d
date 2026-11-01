'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Aviso, Botao } from '@/components/ui';
import type { Arquivo } from '@/lib/tipos';

export interface PlantaResumo {
  id: string;
  status: 'na_fila' | 'processando' | 'pronto' | 'erro';
  mensagem: string | null;
  arquivoId: string;
  arquivoNome: string;
  glbArquivoId: string | null;
  editada: boolean;
  paredes: number;
  aberturas: number;
  comodos: number;
}

const ROTULO = { na_fila: 'Na fila', processando: 'Lendo a planta…', pronto: 'Lida', erro: 'Erro' } as const;

/** Planta baixa (PDF, imagem, DXF) → paredes, portas e janelas detectadas → editor → 3D do prédio. */
export function SecaoPlantas({ plantasArquivos, plantas, podeEditar, ler }: { plantasArquivos: Arquivo[]; plantas: PlantaResumo[]; podeEditar: boolean; ler: (arquivoId: string) => Promise<{ erro?: string }> }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const andamento = plantas.some((p) => p.status === 'na_fila' || p.status === 'processando');
  useEffect(() => {
    if (!andamento) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [andamento, router]);

  if (!plantasArquivos.length)
    return <p className="text-sm text-suave">Envie a planta baixa (PDF, PNG, JPG ou DXF) em “Arquivos 3D e documentos” como “Planta”: o sistema acha paredes, portas e janelas, você confere e vira 3D.</p>;
  return (
    <div className="grid gap-3">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <ul className="divide-y divide-borda text-sm" data-testid="lista-plantas">
        {plantasArquivos.map((a) => {
          const p = plantas.find((x) => x.arquivoId === a.id);
          return (
            <li key={a.id} data-status-planta={p?.status ?? 'nenhuma'} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="grid">
                <strong>{a.nome}</strong>
                {p?.status === 'pronto' && (
                  <span className="text-suave">
                    {p.paredes} paredes · {p.aberturas} portas, janelas e passagens · {p.comodos} cômodos{p.editada ? ' · conferida' : ''}
                    {p.glbArquivoId ? ' · 3D gerado' : ''}
                  </span>
                )}
                {p?.status === 'erro' && <span className="text-perigo">{p.mensagem}</span>}
              </span>
              <span className="flex items-center gap-3">
                {p && <span className="text-xs font-semibold">{ROTULO[p.status]}</span>}
                {p?.status === 'pronto' && podeEditar && (
                  <Link href={`/painel/plantas/${p.id}`} className="font-semibold underline">
                    Abrir editor: {a.nome}
                  </Link>
                )}
                {podeEditar && (!p || p.status === 'erro') && (
                  <Botao
                    type="button"
                    variante="secundario"
                    disabled={ocupado}
                    onClick={() =>
                      iniciar(async () => {
                        setErro(null);
                        const r = await ler(a.id);
                        if (r.erro) setErro(r.erro);
                        router.refresh();
                      })
                    }
                  >
                    Ler planta
                  </Botao>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
