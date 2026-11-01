'use client';
import { useEffect, useRef, useState } from 'react';
import { abrirInterior, type Interior } from '@imersa/viewer';
import { Botao } from '@/components/ui';

/** Interior real (splat) por cima do 3D do prédio. A biblioteca de splats só é baixada aqui. */
export function InteriorSplat({
  arquivo,
  linkDoArquivo,
  aoFechar,
}: {
  arquivo: { id: string; nome: string };
  linkDoArquivo: (arquivoId: string) => Promise<string | null>;
  aoFechar: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const interior = useRef<Interior | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [comLod, setComLod] = useState(false);

  useEffect(() => {
    let vivo = true;
    let aberto: Interior | null = null;
    void linkDoArquivo(arquivo.id).then((url) => {
      const el = canvas.current;
      if (!vivo || !el) return;
      if (!url) return setEstado('erro');
      // ?lod=sempre: árvore de nível de detalhe mesmo em splat pequeno (conferência e testes)
      const lodAcima = new URLSearchParams(window.location.search).get('lod') === 'sempre' ? 0 : undefined;
      aberto = abrirInterior(el, { url, nomeArquivo: arquivo.nome, lodAcima });
      interior.current = aberto;
      aberto.pronto.then(
        () => {
          if (!vivo) return;
          setComLod(aberto?.comLod() ?? false);
          setEstado('pronto');
        },
        () => vivo && setEstado('erro'),
      );
    });
    return () => {
      vivo = false;
      aberto?.destruir();
      interior.current = null;
    };
    // linkDoArquivo fica de fora: muda a cada atualização da página e reabriria o interior
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arquivo.id, arquivo.nome]);

  return (
    <div data-testid="interior" data-estado={estado} data-lod={comLod ? 'sim' : 'nao'} className="absolute inset-0 z-10 bg-black">
      <canvas ref={canvas} className="block h-full w-full touch-none" aria-label={`Interior real: ${arquivo.nome}. WASD ou setas para andar, arraste para olhar.`} />
      {estado === 'carregando' && <p className="absolute inset-0 grid place-items-center text-white">Carregando o interior…</p>}
      {estado === 'erro' && <p className="absolute inset-0 grid place-items-center text-red-300">Não foi possível abrir o interior.</p>}
      <div className="absolute left-3 top-3 flex gap-2">
        <Botao type="button" variante="secundario" onClick={aoFechar}>
          ← Voltar ao prédio
        </Botao>
        {estado === 'pronto' && (
          <Botao type="button" variante="secundario" onClick={() => interior.current?.girar()}>
            Virar imagem
          </Botao>
        )}
      </div>
      <p className="absolute bottom-2 left-3 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        Interior real reconstruído de fotos · WASD ou setas para andar · arraste para olhar
      </p>
    </div>
  );
}
