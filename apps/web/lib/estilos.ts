import type { Padrao } from '@imersa/viewer';
import type { CategoriaMaterial, Material } from './configurador';

/** Decoração com um toque: estilos prontos aplicados com os materiais do catálogo da própria empresa. */
export type Estilo = 'moderno' | 'classico' | 'jovem';

interface Alvo {
  /** Desenhos preferidos, do mais ao menos parecido com o estilo. */
  padroes: readonly Padrao[];
  /** Cor de referência (#rrggbb): vence o material mais perto dela. */
  cor: string;
}

export const ESTILOS: Record<Estilo, { rotulo: string; descricao: string; alvos: Partial<Record<CategoriaMaterial, Alvo>> }> = {
  moderno: {
    rotulo: 'Moderno',
    descricao: 'Cinza e grafite, metal preto, bancada escura',
    alvos: {
      piso: { padroes: ['cimento', 'porcelanato'], cor: '#6b6d6e' },
      parede: { padroes: ['liso', 'cimento'], cor: '#a9aaa6' },
      teto: { padroes: ['liso'], cor: '#f6f5f2' },
      telhado: { padroes: ['liso'], cor: '#8a8f94' },
      esquadria: { padroes: ['liso'], cor: '#2b2c2e' },
      bancada: { padroes: ['marmore', 'liso'], cor: '#2a2a2c' },
    },
  },
  classico: {
    rotulo: 'Clássico',
    descricao: 'Mármore claro, branco e telha cerâmica',
    alvos: {
      piso: { padroes: ['marmore', 'porcelanato'], cor: '#eceae6' },
      parede: { padroes: ['liso'], cor: '#f4f3ef' },
      teto: { padroes: ['liso'], cor: '#f6f5f2' },
      telhado: { padroes: ['tijolo'], cor: '#b5643f' },
      esquadria: { padroes: ['liso'], cor: '#eeeeec' },
      bancada: { padroes: ['liso', 'marmore'], cor: '#f1f0ec' },
    },
  },
  jovem: {
    rotulo: 'Jovem',
    descricao: 'Madeira clara, cor na parede e contraste preto',
    alvos: {
      piso: { padroes: ['madeira'], cor: '#b98d5f' },
      parede: { padroes: ['liso', 'pastilha'], cor: '#9fae94' },
      teto: { padroes: ['liso'], cor: '#f6f5f2' },
      telhado: { padroes: ['tijolo', 'liso'], cor: '#b5643f' },
      esquadria: { padroes: ['liso'], cor: '#2b2c2e' },
      bancada: { padroes: ['liso'], cor: '#f1f0ec' },
    },
  },
};
export const LISTA_ESTILOS: readonly Estilo[] = ['moderno', 'classico', 'jovem'];

const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
/** Distância entre cores (0 a ~442), com o peso do olho (verde pesa mais, azul menos). */
export function distanciaDeCor(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt(0.3 * (r1 - r2) ** 2 + 0.59 * (g1 - g2) ** 2 + 0.11 * (b1 - b2) ** 2);
}

/** Quanto um material foge do alvo: cada posição a menos na lista de desenhos pesa como uma boa diferença de cor. */
function nota(m: Material, alvo: Alvo): number {
  const i = alvo.padroes.indexOf(m.padrao);
  return (i < 0 ? alvo.padroes.length + 2 : i) * 60 + distanciaDeCor(m.cor, alvo.cor);
}

/**
 * Para cada superfície, o material do catálogo (da mesma categoria e ativo) que mais combina com o estilo. Superfície
 * sem material da categoria no catálogo (ou que o estilo não define) fica de fora: continua como estava.
 */
export function escolhasDoEstilo(estilo: Estilo, superficies: ReadonlyArray<{ chave: string; categoria: CategoriaMaterial }>, materiais: readonly Material[]): Record<string, string> {
  const alvos = ESTILOS[estilo].alvos;
  const escolhas: Record<string, string> = {};
  for (const s of superficies) {
    const alvo = alvos[s.categoria];
    if (!alvo) continue;
    let melhor: { id: string; nota: number } | null = null;
    for (const m of materiais) {
      if (m.categoria !== s.categoria || !m.ativo) continue;
      const n = nota(m, alvo);
      if (!melhor || n < melhor.nota) melhor = { id: m.id, nota: n };
    }
    if (melhor) escolhas[s.chave] = melhor.id;
  }
  return escolhas;
}
