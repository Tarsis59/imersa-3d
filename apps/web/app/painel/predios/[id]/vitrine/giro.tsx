'use client';
import { useEffect, useRef, useState } from 'react';
import { indiceDaCor, quadroPorArrasto, type Giro } from '@imersa/viewer';
import { Botao } from '@/components/ui';

/**
 * Giro 360° em imagens: arrastar troca o quadro e tocar lê a cor da máscara para saber a unidade.
 * Não desenha 3D nenhum, por isso fica fluido até em celular fraco.
 */
export function Giro360({
  giro,
  quadro,
  aoMudarQuadro: setQuadro,
  aoSelecionar,
  aoFechar,
}: {
  giro: Giro;
  /** Controlado por quem usa: fechar e abrir de novo volta ao mesmo ângulo. */
  quadro: number;
  aoMudarQuadro: (q: number) => void;
  aoSelecionar: (unidadeId: string | null) => void;
  aoFechar: () => void;
}) {
  // links criados e apagados no mesmo efeito: no modo estrito o React monta duas vezes, e um link apagado
  // na primeira desmontagem quebraria as imagens
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const criados = giro.quadros.map((q) => URL.createObjectURL(q.cor));
    setUrls(criados);
    return () => criados.forEach((u) => URL.revokeObjectURL(u));
  }, [giro]);
  const arrasto = useRef<{ x: number; y: number; inicio: number; moveu: boolean } | null>(null);
  const total = giro.quadros.length;

  async function unidadeNoPonto(quadroAtual: number, fx: number, fy: number): Promise<string | null> {
    const mascara = await createImageBitmap(giro.quadros[quadroAtual]!.mascara);
    const tela = document.createElement('canvas');
    tela.width = mascara.width;
    tela.height = mascara.height;
    const ctx = tela.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(mascara, 0, 0);
    mascara.close();
    const x = Math.min(tela.width - 1, Math.max(0, Math.floor(fx * tela.width)));
    const y = Math.min(tela.height - 1, Math.max(0, Math.floor(fy * tela.height)));
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    const i = indiceDaCor(r!, g!, b!);
    return i === null ? null : (giro.unidades[i] ?? null);
  }

  return (
    <div className="absolute inset-0 z-10 bg-fundo" data-testid="giro" data-quadro={quadro}>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Giro 360° do prédio. Arraste ou use as setas para girar; toque numa unidade para ver os detalhes."
        aria-valuemin={0}
        aria-valuemax={total - 1}
        aria-valuenow={quadro}
        aria-valuetext={`${Math.round((quadro / total) * 360)}°`}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setQuadro((quadro + 1) % total);
          if (e.key === 'ArrowLeft') setQuadro((quadro - 1 + total) % total);
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          arrasto.current = { x: e.clientX, y: e.clientY, inicio: quadro, moveu: false };
        }}
        onPointerMove={(e) => {
          const a = arrasto.current;
          if (!a) return;
          const dx = e.clientX - a.x;
          if (Math.abs(dx) > 6) a.moveu = true;
          // arrastar para a direita gira o prédio para a direita (a câmera vai para a esquerda)
          if (a.moveu) setQuadro(quadroPorArrasto(a.inicio, -dx, e.currentTarget.clientWidth, total));
        }}
        onPointerUp={(e) => {
          const a = arrasto.current;
          arrasto.current = null;
          if (!a || a.moveu) return;
          const r = e.currentTarget.getBoundingClientRect();
          void unidadeNoPonto(quadro, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height).then(aoSelecionar);
        }}
      >
        {/* object-fill: a imagem ocupa exatamente a área, então o ponto tocado corresponde ao pixel da máscara */}
        {/* eslint-disable-next-line @next/next/no-img-element -- imagens geradas no navegador (blob:) */}
        {urls[quadro] && <img src={urls[quadro]} alt="" draggable={false} className="pointer-events-none h-full w-full object-fill" />}
      </div>
      <div className="absolute left-3 top-3 flex gap-2">
        <Botao type="button" variante="secundario" onClick={aoFechar}>
          ← Voltar ao 3D
        </Botao>
      </div>
      <p className="absolute bottom-2 left-3 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        Modo leve: {total} imagens · arraste para girar · toque numa unidade
      </p>
    </div>
  );
}
