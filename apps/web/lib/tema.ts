import type { Marca } from './tipos';

/** Fonte CSS de cada opção (Plano 12b, item 11): lista curta e segura (Google Fonts ou do sistema). */
const FONTE_CSS: Record<Marca['fonte'], string> = {
  sistema: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  inter: "'Inter', system-ui, sans-serif",
  poppins: "'Poppins', system-ui, sans-serif",
  roboto: "'Roboto', system-ui, sans-serif",
  merriweather: "'Merriweather', Georgia, serif",
};

/** Folha de estilo do Google Fonts (grátis) a carregar; `null` para a fonte do sistema (nenhum download). */
export const URL_GOOGLE_FONT: Record<Marca['fonte'], string | null> = {
  sistema: null,
  inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
  poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap',
  roboto: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  merriweather: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap',
};

function luminanciaRelativa(hex: string): number {
  const n = hex.replace('#', '');
  const canal = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => canal(parseInt(n.slice(i, i + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Contraste (WCAG) entre duas cores, pela luminância relativa de cada uma. */
export function contraste(hexA: string, hexB: string): number {
  const la = luminanciaRelativa(hexA);
  const lb = luminanciaRelativa(hexB);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Contraste mínimo AA garantido (Plano 12b, item 11): se o branco não chegar a 4,5:1 na cor da marca, o texto do
 * botão vira escuro em vez de branco (ajuste automático, sem a gestão precisar escolher).
 */
export function textoSobre(corDeFundo: string): string {
  return contraste('#ffffff', corDeFundo) >= 4.5 ? '#ffffff' : '#0f172a';
}

/** Variáveis CSS do tema (Plano 12b, item 11): aplicadas no portal, no estande e na Vitrine do painel. */
export function estiloMarca(marca: Pick<Marca, 'corPrimaria' | 'fonte'> | null | undefined): Record<string, string> {
  if (!marca) return {};
  const estilo: Record<string, string> = { '--font-sans': FONTE_CSS[marca.fonte] };
  if (marca.corPrimaria) {
    estilo['--acento'] = marca.corPrimaria;
    estilo['--acento-texto'] = textoSobre(marca.corPrimaria);
  }
  return estilo;
}
