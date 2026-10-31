/**
 * Acabamento = material PBR desenhado no próprio navegador: um padrão (madeira, porcelanato...) pintado num canvas
 * que repete a cada `escalaM` metros, mais rugosidade e metal. Sem imagens para baixar: troca na hora.
 */
export type Padrao = 'liso' | 'madeira' | 'porcelanato' | 'marmore' | 'cimento' | 'tijolo' | 'pastilha';
export const PADROES: readonly Padrao[] = ['liso', 'madeira', 'porcelanato', 'marmore', 'cimento', 'tijolo', 'pastilha'];

export interface Acabamento {
  padrao: Padrao;
  /** #rrggbb */
  cor: string;
  cor2?: string | null;
  rugosidade: number;
  metalico: number;
  /** Tamanho de uma repetição do desenho, em metros. */
  escalaM: number;
}

const hex = (cor: string): [number, number, number] => {
  if (!/^#[0-9a-f]{6}$/i.test(cor)) throw new Error(`cor inválida: ${cor}`);
  return [parseInt(cor.slice(1, 3), 16), parseInt(cor.slice(3, 5), 16), parseInt(cor.slice(5, 7), 16)];
};
const paraHex = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`;

/** Segunda cor quando não foi escolhida: um tom mais escuro (rejunte, veio, nó) ou mais claro, se a cor já é escura. */
export function corDerivada(cor: string): string {
  const [r, g, b] = hex(cor);
  const luz = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const f = luz > 0.35 ? 0.72 : 1.45;
  return paraHex(r * f, g * f, b * f);
}

/** Mistura duas cores (t = 0 → a, 1 → b). */
export function misturar(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return paraHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

/** Gerador determinístico (o mesmo acabamento desenha sempre igual: miniaturas e 3D batem). */
export function aleatorio(semente: number): () => number {
  let s = semente >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Chave do cache de texturas: escala, rugosidade e metal não redesenham (só mudam `repeat` e números). */
export const chaveDoDesenho = (a: Pick<Acabamento, 'padrao' | 'cor' | 'cor2'>) => `${a.padrao}|${a.cor.toLowerCase()}|${(a.cor2 ?? '').toLowerCase()}`;

/** O mínimo de canvas 2D que o desenho usa (no teste, um falso). */
export type Contexto2D = Pick<CanvasRenderingContext2D, 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'arc' | 'fill'> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
};

/** Desenha UMA repetição do padrão num quadrado de `t` pixels (as bordas casam para repetir sem emenda). */
export function desenharPadrao(ctx: Contexto2D, t: number, a: Pick<Acabamento, 'padrao' | 'cor' | 'cor2'>): void {
  const base = a.cor;
  const segunda = a.cor2 ?? corDerivada(a.cor);
  const rnd = aleatorio([...chaveDoDesenho(a)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7));
  ctx.globalAlpha = 1;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, t, t);
  const linha = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  switch (a.padrao) {
    case 'liso':
      return;
    case 'madeira': {
      // 4 réguas por repetição, com tons diferentes e fibras finas
      const reguas = 4;
      const h = t / reguas;
      for (let i = 0; i < reguas; i++) {
        ctx.fillStyle = misturar(base, segunda, rnd() * 0.35);
        ctx.fillRect(0, i * h, t, h);
        ctx.strokeStyle = segunda;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1;
        for (let f = 0; f < 10; f++) {
          const y = i * h + rnd() * h;
          linha(0, y, t, y + (rnd() - 0.5) * 4);
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = Math.max(1, t / 256);
        linha(0, i * h, t, i * h);
        const junta = rnd() * t; // emenda da régua, em lugar diferente em cada uma
        linha(junta, i * h, junta, (i + 1) * h);
      }
      return;
    }
    case 'porcelanato':
    case 'pastilha': {
      // peça inteira com rejunte nas bordas; pastilha = 4×4 peças pequenas
      const n = a.padrao === 'pastilha' ? 4 : 1;
      const p = t / n;
      ctx.strokeStyle = segunda;
      ctx.lineWidth = Math.max(2, t / (a.padrao === 'pastilha' ? 64 : 128));
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = misturar(base, segunda, rnd() * 0.12);
          ctx.fillRect(i * p, j * p, p, p);
        }
      for (let i = 0; i <= n; i++) {
        linha(i * p, 0, i * p, t);
        linha(0, i * p, t, i * p);
      }
      return;
    }
    case 'marmore': {
      ctx.strokeStyle = segunda;
      for (let v = 0; v < 7; v++) {
        ctx.globalAlpha = 0.25 + rnd() * 0.35;
        ctx.lineWidth = 1 + rnd() * 2.5;
        let x = rnd() * t;
        let y = 0;
        ctx.beginPath();
        ctx.moveTo(x, y);
        while (y < t) {
          y += t / 24;
          x += (rnd() - 0.5) * (t / 10);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'cimento': {
      ctx.fillStyle = segunda;
      for (let i = 0; i < 900; i++) {
        ctx.globalAlpha = 0.04 + rnd() * 0.1;
        ctx.beginPath();
        ctx.arc(rnd() * t, rnd() * t, 1 + rnd() * (t / 64), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    case 'tijolo': {
      // 4 fiadas por repetição, juntas desencontradas
      const fiadas = 4;
      const h = t / fiadas;
      ctx.strokeStyle = segunda;
      ctx.lineWidth = Math.max(2, t / 96);
      for (let i = 0; i < fiadas; i++) {
        const desloc = (i % 2) * (t / 4);
        for (let k = 0; k < 2; k++) {
          // o tijolo que passa da borda continua do outro lado (a repetição não tem emenda)
          const x = desloc + k * (t / 2);
          ctx.fillStyle = misturar(base, segunda, rnd() * 0.25);
          ctx.fillRect(x, i * h, t / 2, h);
          if (x + t / 2 > t) ctx.fillRect(x - t, i * h, t / 2, h);
        }
        linha(0, i * h, t, i * h);
        linha(desloc, i * h, desloc, (i + 1) * h);
        linha(desloc + t / 2, i * h, desloc + t / 2, (i + 1) * h);
      }
      return;
    }
  }
}
