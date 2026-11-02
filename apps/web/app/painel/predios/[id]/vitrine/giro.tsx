'use client';
import { useEffect, useRef, useState } from 'react';
import { indiceMaisProximo, quadroPorArrasto, type Giro } from '@imersa/viewer';
import { Botao } from '@/components/ui';
import { pontoNaImagem } from '@/lib/giro-zip';

/**
 * Giro 360° em imagens: arrastar troca o quadro e tocar lê a cor da máscara para saber a unidade.
 * Não desenha 3D nenhum, por isso fica fluido até em celular fraco.
 * `fotorrealista`: o giro renderizado no Blender (tamanho fixo): a imagem cabe inteira na área, sem esticar, e o
 * toque desconta as faixas em volta. O giro leve é feito do tamanho da própria tela e ocupa a área toda.
 */

export function Giro360({
  giro,
  quadro,
  aoMudarQuadro: setQuadro,
  aoSelecionar,
  aoFechar,
  fotorrealista = false,
}: {
  giro: Giro;
  fotorrealista?: boolean;
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
    // o dedo é impreciso: caiu numa laje, pilar ou fresta, vale a unidade mais perto (até ~3% da imagem)
    const raio = Math.max(4, Math.round(Math.min(tela.width, tela.height) * 0.03));
    const x0 = Math.max(0, x - raio);
    const y0 = Math.max(0, y - raio);
    const janela = ctx.getImageData(x0, y0, Math.min(tela.width, x + raio + 1) - x0, Math.min(tela.height, y + raio + 1) - y0);
    const i = indiceMaisProximo(janela.data, janela.width, janela.height, x - x0, y - y0, raio);
    return i === null ? null : (giro.unidades[i] ?? null);
  }

  return (
    <div className="absolute inset-0 z-10 bg-fundo" data-testid="giro" data-quadro={quadro} data-tipo={fotorrealista ? 'fotorrealista' : 'leve'}>
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
          const p = pontoNaImagem(e.clientX - r.left, e.clientY - r.top, { largura: r.width, altura: r.height }, fotorrealista ? { largura: giro.largura, altura: giro.altura } : null);
          if (!p) return aoSelecionar(null); // tocou na faixa fora da imagem
          void unidadeNoPonto(quadro, p.fx, p.fy).then(aoSelecionar);
        }}
      >
        {/* leve: object-fill (a imagem ocupa exatamente a área); fotorrealista: object-contain (pontoNaImagem desconta as faixas) */}
        {/* eslint-disable-next-line @next/next/no-img-element -- imagens em blob: */}
        {urls[quadro] && <img src={urls[quadro]} alt="" draggable={false} className={`pointer-events-none h-full w-full ${fotorrealista ? 'object-contain' : 'object-fill'}`} />}
      </div>
      <div className="absolute left-3 top-3 flex gap-2">
        <Botao type="button" variante="secundario" onClick={aoFechar}>
          ← Voltar ao 3D
        </Botao>
      </div>
      <p className="absolute bottom-2 left-3 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {fotorrealista ? 'Fotorrealista' : 'Modo leve'}: {total} imagens · arraste para girar · toque numa unidade
      </p>
    </div>
  );
}
