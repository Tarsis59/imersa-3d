'use client';
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Aviso, Botao, Campo } from '@/components/ui';
import { ROTULO_STATUS_CAPTURA, tamanhoLegivel, type Captura, type StatusCaptura } from '@/lib/tipos';
import { concluirEnvio, prepararEnvio } from './actions-arquivos';
import { cancelarCaptura, criarCaptura, reenviarCaptura } from './actions-capturas';
import { enviarComProgresso } from './secoes';

const COR: Record<StatusCaptura, string> = {
  aguardando_envio: 'bg-slate-200 text-slate-800',
  na_fila: 'bg-slate-200 text-slate-800',
  processando: 'bg-sky-100 text-sky-900',
  revisao: 'bg-amber-100 text-amber-950',
  publicado: 'bg-emerald-100 text-emerald-900',
  erro: 'bg-red-100 text-red-900',
  cancelado: 'bg-slate-100 text-slate-600',
};
const EM_ANDAMENTO: StatusCaptura[] = ['na_fila', 'processando'];

export function SecaoCapturas({ projetoId, capturas, podeEnviar, podeRevisar }: { projetoId: string; capturas: Captura[]; podeEnviar: boolean; podeRevisar: boolean }) {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [ocupado, iniciar] = useTransition();

  // enquanto alguma estiver na fila/processando, atualiza sozinho (a GPU leva de minutos a uma hora)
  const andamento = capturas.some((c) => EM_ANDAMENTO.includes(c.status));
  useEffect(() => {
    if (!andamento) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [andamento, router]);

  async function enviar() {
    if (!arquivo || !nome.trim()) return;
    setAviso(null);
    const preparo = await prepararEnvio(projetoId, arquivo.name, 'captura', arquivo.size);
    if (!preparo.ok) return setAviso({ tipo: 'erro', texto: preparo.erro });
    setProgresso(0);
    try {
      const status = await enviarComProgresso(preparo.url, preparo.cabecalhos, arquivo, setProgresso);
      if (status >= 400) throw new Error(`O armazenamento recusou o envio (${status}).`);
      const fim = await concluirEnvio(projetoId, preparo.id);
      if (fim.status !== 'pronto') throw new Error(fim.erro ?? 'O arquivo foi recusado na verificação.');
      const c = await criarCaptura(projetoId, nome.trim(), preparo.id);
      if (c.erro) throw new Error(c.erro);
      setAviso({ tipo: 'sucesso', texto: `${nome.trim()}: enviado. O 3D fica pronto em alguns minutos a uma hora; esta lista atualiza sozinha.` });
      setNome('');
      setArquivo(null);
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setProgresso(null);
      router.refresh();
    }
  }

  const acao = (fn: () => Promise<{ erro?: string }>) =>
    iniciar(async () => {
      const r = await fn();
      if (r.erro) setAviso({ tipo: 'erro', texto: r.erro });
    });

  return (
    <div className="grid gap-4">
      <details className="rounded-lg border border-borda p-3 text-sm">
        <summary className="cursor-pointer font-medium">Como capturar (2 a 5 minutos por ambiente)</summary>
        <ol className="mt-2 grid list-decimal gap-1 pl-5 text-suave">
          <li>Acenda todas as luzes e abra as cortinas; evite fotografar contra a janela.</li>
          <li>Use a câmera principal do celular, sem zoom, na horizontal.</li>
          <li>Ande devagar pelo ambiente: cada foto deve repetir boa parte da anterior.</li>
          <li>Faça de 80 a 300 fotos (ou um vídeo andando devagar, de 1 a 3 minutos).</li>
          <li>Compacte as fotos num ZIP (ou envie o vídeo direto) e envie aqui.</li>
        </ol>
        <p className="mt-2 text-suave">Rostos que aparecerem são desfocados automaticamente antes do processamento (LGPD).</p>
      </details>

      {capturas.length === 0 ? (
        <p className="text-suave">Nenhuma captura ainda.</p>
      ) : (
        <ul className="divide-y divide-borda" data-testid="lista-capturas">
          {capturas.map((c) => (
            <li key={c.id} data-status-captura={c.status} className="grid gap-1 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{c.nome}</strong> <span className="text-suave">· {c.origem === 'fotos' ? 'fotos' : 'vídeo'} · {c.arquivoNome}</span>
                </span>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${COR[c.status]}`}>{ROTULO_STATUS_CAPTURA[c.status]}</span>
              </div>
              {c.mensagem && <p className={c.status === 'erro' ? 'text-perigo' : 'text-suave'}>{c.mensagem}</p>}
              {c.detalhes.length > 0 && (
                <ul className="list-disc pl-5 text-perigo">
                  {c.detalhes.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-3">
                {podeRevisar && ['revisao', 'publicado'].includes(c.status) && (
                  <Link href={`/painel/capturas/${c.id}`} className="font-medium underline">
                    {c.status === 'revisao' ? 'Revisar e publicar' : 'Ver detalhes'}
                  </Link>
                )}
                {podeRevisar && ['erro', 'cancelado'].includes(c.status) && (
                  <button type="button" className="underline" disabled={ocupado} onClick={() => acao(() => reenviarCaptura(projetoId, c.id))}>
                    Tentar de novo
                  </button>
                )}
                {podeRevisar && ['na_fila', 'processando', 'revisao', 'erro'].includes(c.status) && (
                  <button type="button" className="text-perigo underline" disabled={ocupado} onClick={() => acao(() => cancelarCaptura(projetoId, c.id))}>
                    Cancelar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {podeEnviar && (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Campo id="captura-nome" rotulo="Ambiente" placeholder="Sala do apto 101" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
          <label htmlFor="captura-envio" className="grid gap-1 text-sm">
            <span className="font-medium">Fotos (.zip) ou vídeo</span>
            <input
              id="captura-envio"
              type="file"
              accept=".zip,.mp4,.mov,video/*"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-lg file:border file:border-borda file:bg-superficie file:px-3 file:py-2"
            />
          </label>
          <Botao type="button" onClick={enviar} disabled={!arquivo || !nome.trim() || progresso !== null}>
            {progresso !== null ? `Enviando ${progresso}%` : 'Enviar para 3D'}
          </Botao>
          {arquivo && <p className="text-xs text-suave sm:col-span-3">{tamanhoLegivel(arquivo.size)}</p>}
          {progresso !== null && (
            <progress value={progresso} max={100} className="h-2 w-full sm:col-span-3" aria-label="Progresso do envio">
              {progresso}%
            </progress>
          )}
        </div>
      )}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
    </div>
  );
}
