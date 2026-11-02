import type { MetadataRoute } from 'next';

/**
 * Manifesto do app instalável (Plano 12b, item 13): "Adicionar à tela inicial" no iPhone e no Android abre em tela
 * cheia, como app. Cada link de cliente tem o seu, que abre direto no empreendimento dele (não na página inicial).
 */
export function manifesto(o: { nome: string; curto: string; inicio: string; escopo: string; descricao: string }): MetadataRoute.Manifest {
  return {
    name: o.nome,
    short_name: o.curto.slice(0, 12),
    description: o.descricao,
    start_url: o.inicio,
    scope: o.escopo,
    display: 'standalone',
    orientation: 'any',
    background_color: '#0b1220',
    theme_color: '#0369a1',
    lang: 'pt-BR',
    icons: [
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icone-mascaravel-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
