'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Botao } from '@/components/ui';
import { useAtualizarEnquanto } from '@/lib/atualizacao';
import type { VideosDoPredio } from '@/lib/tipos';

const FORMATOS = [
  { formato: '9:16', nome: 'Reels e Stories (9:16)' },
  { formato: '1:1', nome: 'Feed e WhatsApp (1:1)' },
  { formato: '16:9', nome: 'YouTube e site (16:9)' },
] as const;
const ROTULO = { na_fila: 'Na fila', processando: 'Renderizando na GPU', pronto: 'Pronto', erro: 'Erro' } as const;
const VOZES = [
  { voz: '', nome: 'Sem narração' },
  { voz: 'pf_dora', nome: 'Voz feminina (Dora)' },
  { voz: 'pm_alex', nome: 'Voz masculina (Alex)' },
] as const;
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Estúdio de marketing: vídeo do prédio de verdade (o modelo 3D, renderizado no Blender com luz do sol e sombras),
 * passeio de câmera de 10 s nos formatos das redes, sempre com o selo "Imagem ilustrativa".
 */
export function Estudio({
  dados,
  podePedir,
  pedir,
  linkDoArquivo,
}: {
  dados: VideosDoPredio;
  podePedir: boolean;
  pedir: (formato: (typeof FORMATOS)[number]['formato'], narracao: { voz: 'pf_dora' | 'pm_alex'; texto?: string } | null) => Promise<{ erro?: string }>;
  linkDoArquivo: (arquivoId: string) => Promise<string | null>;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const [tocando, setTocando] = useState<{ id: string; url: string; capa: string | null } | null>(null);
  // narração em português (Kokoro): voz e, se quiser, o roteiro; vazio = roteiro automático com os dados do prédio
  const [voz, setVoz] = useState<'' | 'pf_dora' | 'pm_alex'>('');
  const [roteiro, setRoteiro] = useState('');
  const andamento = dados.videos.some((v) => v.status === 'na_fila' || v.status === 'processando');
  useAtualizarEnquanto(andamento, 60_000);
  const emAndamento = (f: string) => dados.videos.some((v) => v.formato === f && (v.status === 'na_fila' || v.status === 'processando'));

  async function assistir(id: string, arquivoId: string, capaId: string | null) {
    setErro(null);
    const [url, capa] = await Promise.all([linkDoArquivo(arquivoId), capaId ? linkDoArquivo(capaId) : Promise.resolve(null)]);
    if (!url) return setErro('Não foi possível abrir o vídeo.');
    setTocando({ id, url, capa });
  }
  async function baixar(arquivoId: string) {
    const url = await linkDoArquivo(arquivoId);
    if (url) window.location.href = url;
    else setErro('Não foi possível baixar o vídeo.');
  }

  return (
    <div className="grid gap-4 text-sm" data-testid="estudio">
      <p className="text-suave">
        Vídeos curtos do prédio real (o modelo 3D, não imagem inventada por IA), com câmera de cinema, luz do sol e sombras, prontos para postar. Todo vídeo sai
        com o selo “Imagem ilustrativa”. O render roda numa placa de vídeo gratuita na nuvem; a fila é conferida de hora em hora.
      </p>
      {!dados.temModelo && <Aviso tipo="info">Ligue um modelo 3D ao prédio para gerar vídeos.</Aviso>}
      {podePedir && dados.temModelo && (
        <fieldset className="grid gap-2 rounded-lg border border-borda p-3" data-testid="narracao-video">
          <legend className="px-1 font-medium">Narração</legend>
          <label className="grid gap-1">
            <span>Voz</span>
            <select value={voz} onChange={(e) => setVoz(e.target.value as typeof voz)} className="rounded-lg border border-borda bg-superficie px-3 py-2">
              {VOZES.map((v) => (
                <option key={v.voz} value={v.voz}>
                  {v.nome}
                </option>
              ))}
            </select>
          </label>
          {voz && (
            <label className="grid gap-1">
              <span>Roteiro (opcional)</span>
              <textarea
                value={roteiro}
                maxLength={600}
                rows={3}
                onChange={(e) => setRoteiro(e.target.value)}
                placeholder="Em branco: o roteiro sai dos dados do prédio (unidades disponíveis, preço a partir de e o lazer)."
                className="rounded-lg border border-borda bg-superficie px-3 py-2"
              />
              <span className="text-xs text-suave">Locução em português com legenda. Para 10 s, até umas 23 palavras.</span>
            </label>
          )}
        </fieldset>
      )}
      {podePedir && dados.temModelo && (
        <div className="flex flex-wrap gap-2">
          {FORMATOS.map((f) => (
            <Botao
              key={f.formato}
              type="button"
              variante="secundario"
              disabled={enviando || emAndamento(f.formato)}
              onClick={() =>
                iniciar(async () => {
                  setErro(null);
                  const r = await pedir(f.formato, voz ? { voz, texto: roteiro } : null);
                  if (r.erro) setErro(r.erro);
                  else router.refresh();
                })
              }
            >
              {emAndamento(f.formato) ? `${f.nome}: na fila…` : `Gerar vídeo ${f.nome}`}
            </Botao>
          ))}
        </div>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados.videos.length > 0 && (
        <ul className="divide-y divide-borda" data-testid="lista-videos">
          {dados.videos.map((v) => (
            <li key={v.id} className="grid gap-2 py-3" data-status-video={v.status} data-formato={v.formato}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{FORMATOS.find((f) => f.formato === v.formato)?.nome ?? v.formato}</strong> · {ROTULO[v.status]} · {quando(v.criadoEm)}
                  {v.narracao && <span data-testid="video-narrado"> · narração: {VOZES.find((x) => x.voz === v.narracao!.voz)?.nome ?? v.narracao.voz}</span>}
                  {v.status === 'pronto' && v.metricas.mb ? ` · ${v.metricas.mb.toLocaleString('pt-BR')} MB` : ''}
                  {v.status === 'pronto' && !v.atual ? ' · modelo antigo do prédio' : ''}
                </span>
                {v.status === 'pronto' && v.arquivoId && (
                  <span className="flex gap-2">
                    <Botao type="button" variante="secundario" onClick={() => void assistir(v.id, v.arquivoId!, v.capaId)}>
                      Assistir
                    </Botao>
                    <Botao type="button" onClick={() => void baixar(v.arquivoId!)}>
                      Baixar MP4
                    </Botao>
                  </span>
                )}
              </div>
              {v.status === 'erro' && v.mensagem && <p className="text-perigo">{v.mensagem}</p>}
              {tocando?.id === v.id && (
                // eslint-disable-next-line jsx-a11y/media-has-caption -- vídeo sem fala (passeio de câmera, sem áudio)
                <video
                  src={tocando.url}
                  poster={tocando.capa ?? undefined}
                  controls
                  autoPlay
                  muted
                  playsInline
                  className={`max-h-[70vh] rounded-lg bg-black ${v.formato === '9:16' ? 'w-auto' : 'w-full'}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
