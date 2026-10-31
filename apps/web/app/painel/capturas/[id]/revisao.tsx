'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { abrirInterior, type Interior } from '@imersa/viewer';
import { Aviso, Botao, Cartao } from '@/components/ui';
import type { Captura } from '@/lib/tipos';
import { cancelarCaptura, linkPrevia, publicarCaptura } from '../../projetos/[id]/actions-capturas';

/** Prévia do 3D gerado (antes de aparecer na Vitrine) e decisão da gestão. */
export function Revisao({ projetoId, captura }: { projetoId: string; captura: Captura }) {
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const interior = useRef<Interior | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  useEffect(() => {
    let vivo = true;
    let aberto: Interior | null = null;
    void linkPrevia(captura.id).then((l) => {
      if (!vivo || !canvas.current) return;
      if (!l) return setEstado('erro');
      aberto = abrirInterior(canvas.current, { url: l.url, nomeArquivo: l.nome });
      interior.current = aberto;
      aberto.pronto.then(
        () => vivo && setEstado('pronto'),
        () => vivo && setEstado('erro'),
      );
    });
    return () => {
      vivo = false;
      aberto?.destruir();
    };
  }, [captura.id]);

  const decidir = (fn: () => Promise<{ erro?: string }>, depois?: string) =>
    iniciar(async () => {
      const r = await fn();
      if (r.erro) return setErro(r.erro);
      if (depois) router.push(depois);
      else router.refresh();
    });

  return (
    <Cartao titulo={captura.status === 'revisao' ? 'Revisar antes de publicar' : 'Interior publicado'}>
      <div className="grid gap-4">
        <div data-testid="previa-captura" data-estado={estado} className="relative h-[60vh] min-h-80 overflow-hidden rounded-2xl border border-borda bg-black">
          <canvas ref={canvas} className="block h-full w-full touch-none" aria-label="Prévia do interior em 3D. WASD ou setas para andar, arraste para olhar." />
          {estado === 'carregando' && <p className="absolute inset-0 grid place-items-center text-white">Carregando a prévia…</p>}
          {estado === 'erro' && <p className="absolute inset-0 grid place-items-center text-red-300">Não foi possível abrir a prévia.</p>}
          {estado === 'pronto' && (
            <Botao type="button" variante="secundario" className="absolute left-3 top-3" onClick={() => interior.current?.girar()}>
              Virar imagem
            </Botao>
          )}
        </div>
        {captura.status === 'revisao' && (
          <div className="flex flex-wrap gap-3">
            <Botao type="button" disabled={ocupado || estado !== 'pronto'} onClick={() => decidir(() => publicarCaptura(projetoId, captura.id))}>
              Publicar na Vitrine
            </Botao>
            <Botao type="button" variante="perigo" disabled={ocupado} onClick={() => decidir(() => cancelarCaptura(projetoId, captura.id), `/painel/projetos/${projetoId}`)}>
              Descartar
            </Botao>
          </div>
        )}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </div>
    </Cartao>
  );
}
