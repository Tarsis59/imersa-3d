import { lerNumeroBr } from '../dominio/numeros';
import type { StatusUnidade } from '../dominio/status';
import { normalizar, numerosPorExtenso } from './texto';

/**
 * Pedidos por texto da gestão (Plano 11e, itens 22 e 23): "a 302 foi vendida", "a 1201 custa 850 mil",
 * "o 5º andar agora tem 6 unidades", "vídeo para o Instagram com voz masculina", "foto do pôr do sol da 1201".
 * Só lê: quem grava é a rota, depois que a pessoa confirma a prévia.
 */
export type PedidoGestao =
  | { tipo: 'status'; codigo: string; status: StatusUnidade }
  | { tipo: 'preco'; codigo: string; preco: number }
  | { tipo: 'unidades_no_andar'; andar: number; quantidade: number }
  | { tipo: 'video'; formato: '9:16' | '1:1' | '16:9'; voz: 'pf_dora' | 'pm_alex' | null; duracaoPedida: number | null }
  | { tipo: 'foto'; codigo: string | null; hora: number };

const CODIGO = String.raw`([a-z]?-?\d{2,5}[a-z]?)`;

function dinheiro(numero: string, escala: string | undefined): number | null {
  const v = lerNumeroBr(numero.replace(/[.,]$/, ''));
  if (typeof v !== 'number' || v <= 0) return null;
  const e = !escala ? 1 : /^(mil|k)$/.test(escala) ? 1e3 : 1e6;
  const total = Math.round(v * e);
  return total >= 10_000 && total < 1e10 ? total : null;
}

/** Lê os pedidos (pode haver mais de um, separados por vírgula, ponto ou "e"). Nunca lança. */
export function lerPedidosGestao(texto: string): PedidoGestao[] {
  const n = numerosPorExtenso(normalizar(texto.slice(0, 500)).replace(/[º°ª]/g, ''));
  const pedidos: PedidoGestao[] = [];
  // ponto só separa frase no fim dela ("700.000" é número)
  for (const frase of n.split(/\s*(?:\.(?=\s|$)|[;\n]|,\s*(?=(?:a|o|e)\s)|\se\s(?=(?:a|o)\s))\s*/).filter(Boolean)) {
    // material de venda
    if (/\b(video|filme|reels?|stories|tiktok)\b/.test(frase)) {
      const formato = /\b(youtube|horizontal|tv|deitado|paisagem)\b/.test(frase) ? '16:9' : /\b(feed|quadrado)\b/.test(frase) ? '1:1' : '9:16';
      const voz = /\b(sem (voz|narracao|locucao)|mudo)\b/.test(frase) ? null : /\bvoz (masculina|de homem)|\bnarrador\b|\balex\b/.test(frase) ? 'pm_alex' : /\bvoz (feminina|de mulher)|\bnarradora\b|\bdora\b/.test(frase) ? 'pf_dora' : null;
      const d = frase.match(/\b(\d{1,3})\s*(?:s|seg|segundos)\b/);
      pedidos.push({ tipo: 'video', formato, voz, duracaoPedida: d ? Number(d[1]) : null });
      continue;
    }
    if (/\bfoto\b/.test(frase)) {
      const c = frase.match(new RegExp(String.raw`\b(?:da|do|unidade|apto?)\s*${CODIGO}\b`));
      const hora = /\b(por do sol|entardecer|fim de tarde)\b/.test(frase) ? 18 : /\b(noite|noturna)\b/.test(frase) ? 21 : /\b(manha|nascer do sol)\b/.test(frase) ? 8 : 15;
      pedidos.push({ tipo: 'foto', codigo: c ? c[1]!.toUpperCase() : null, hora });
      continue;
    }
    // unidades no andar
    const a = frase.match(/\b(\d{1,3})\s*(?:andar|pavimento)\b.*?\b(?:tem|terá|tera|passa a ter|com)\s*(\d{1,2})\s*(?:unidades|aptos?|apartamentos)\b/);
    if (a) {
      pedidos.push({ tipo: 'unidades_no_andar', andar: Number(a[1]), quantidade: Number(a[2]) });
      continue;
    }
    const cod = frase.match(new RegExp(String.raw`\b(?:a|o|unidade|apto?|apartamento)\s+${CODIGO}\b`)) ?? frase.match(new RegExp(String.raw`\b${CODIGO}\b`));
    if (!cod) continue;
    const codigo = cod[1]!.toUpperCase();
    // preço
    if (/\b(custa|preco|valor|vale|mil|milhao)\b|r\$/.test(frase)) {
      // o primeiro valor em reais da frase (o código da unidade, pequeno, não passa como preço)
      const v = [...frase.matchAll(/(?:r\$\s*)?(\d[\d.,]*)\s*(mil|milhao|milhoes|mi|k)?\b/g)].map((m) => dinheiro(m[1]!, m[2])).find((x) => x !== null);
      if (v !== undefined && v !== null) {
        pedidos.push({ tipo: 'preco', codigo, preco: v });
        continue;
      }
    }
    // situação
    const status: StatusUnidade | null = /\b(vendid[ao]|vende(u)?|vender|venda fechada)\b/.test(frase)
      ? 'vendido'
      : /\b(reservad[ao]|reserva(r)?)\b/.test(frase)
        ? 'reservado'
        : /\b(disponivel|livre|volta(r|ou)? (a ficar )?(para venda|disponivel)|distrato|libera(r)?)\b/.test(frase)
          ? 'disponivel'
          : /\b(bloquead[ao]|bloqueia(r)?|tira(r)? da venda)\b/.test(frase)
            ? 'bloqueado'
            : null;
    if (status) pedidos.push({ tipo: 'status', codigo, status });
  }
  return pedidos;
}
