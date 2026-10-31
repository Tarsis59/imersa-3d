/**
 * Móveis padrão do Imersa: desenhados aqui mesmo, com peças simples (caixas e cilindros) nas medidas comuns de
 * mercado. Licença própria (Imersa 3D), sem arquivo para baixar e sem direito de terceiros. Móveis de verdade
 * (GLB de fornecedor, com licença registrada) entram pelo catálogo da empresa.
 * Origem de cada móvel: centro da base no chão (y = 0); frente virada para +z.
 */
export type CategoriaMovel = 'sala' | 'quarto' | 'cozinha' | 'banheiro' | 'escritorio' | 'externo' | 'decoracao';

export interface PecaMovel {
  forma: 'caixa' | 'cilindro';
  /** largura (x), altura (y), profundidade (z) em metros; no cilindro, largura = diâmetro. */
  tamanho: [number, number, number];
  /** centro da peça */
  posicao: [number, number, number];
  cor: string;
  rugosidade?: number;
}

export interface MovelPadrao {
  chave: string;
  nome: string;
  categoria: CategoriaMovel;
  /** largura, altura, profundidade totais (m) */
  dimensoes: [number, number, number];
  pecas: PecaMovel[];
}

export const LICENCA_PADRAO = { licenca: 'Própria (Imersa 3D)', autor: 'Imersa 3D' } as const;

const TECIDO = '#8c8f94';
const MADEIRA = '#a77b52';
const BRANCO = '#f1efe9';
const PRETO = '#26282b';

/** Caixa apoiada: `y0` é a altura da base da peça. */
const caixa = (w: number, h: number, d: number, x: number, y0: number, z: number, cor: string, rugosidade?: number): PecaMovel => ({
  forma: 'caixa',
  tamanho: [w, h, d],
  posicao: [x, y0 + h / 2, z],
  cor,
  ...(rugosidade !== undefined ? { rugosidade } : {}),
});
const cilindro = (diam: number, h: number, x: number, y0: number, z: number, cor: string): PecaMovel => ({ forma: 'cilindro', tamanho: [diam, h, diam], posicao: [x, y0 + h / 2, z], cor });
/** 4 pés nos cantos de um retângulo w × d */
const pes = (w: number, d: number, h: number, lado: number, cor: string): PecaMovel[] =>
  [-1, 1].flatMap((sx) => [-1, 1].map((sz) => caixa(lado, h, lado, sx * (w / 2 - lado / 2), 0, sz * (d / 2 - lado / 2), cor)));

export const MOVEIS_PADRAO: readonly MovelPadrao[] = [
  {
    chave: 'sofa-3',
    nome: 'Sofá 3 lugares',
    categoria: 'sala',
    dimensoes: [2.1, 0.85, 0.9],
    pecas: [caixa(2.1, 0.42, 0.9, 0, 0, 0, TECIDO), caixa(2.1, 0.43, 0.2, 0, 0.42, -0.35, TECIDO), caixa(0.18, 0.2, 0.9, -0.96, 0.42, 0, TECIDO), caixa(0.18, 0.2, 0.9, 0.96, 0.42, 0, TECIDO)],
  },
  {
    chave: 'poltrona',
    nome: 'Poltrona',
    categoria: 'sala',
    dimensoes: [0.8, 0.85, 0.8],
    pecas: [caixa(0.8, 0.42, 0.8, 0, 0, 0, TECIDO), caixa(0.8, 0.43, 0.18, 0, 0.42, -0.31, TECIDO)],
  },
  {
    chave: 'rack-tv',
    nome: 'Rack com TV',
    categoria: 'sala',
    dimensoes: [1.8, 1.25, 0.45],
    pecas: [caixa(1.8, 0.5, 0.45, 0, 0, 0, MADEIRA, 0.6), caixa(1.4, 0.75, 0.05, 0, 0.5, -0.1, PRETO, 0.3)],
  },
  {
    chave: 'mesa-centro',
    nome: 'Mesa de centro',
    categoria: 'sala',
    dimensoes: [1.0, 0.4, 0.6],
    pecas: [caixa(1.0, 0.05, 0.6, 0, 0.35, 0, MADEIRA, 0.5), ...pes(1.0, 0.6, 0.35, 0.05, MADEIRA)],
  },
  {
    chave: 'tapete',
    nome: 'Tapete 2 × 1,4 m',
    categoria: 'decoracao',
    dimensoes: [2.0, 0.01, 1.4],
    pecas: [caixa(2.0, 0.01, 1.4, 0, 0, 0, '#b9a58a', 1)],
  },
  {
    chave: 'mesa-4',
    nome: 'Mesa de jantar 4 lugares',
    categoria: 'sala',
    dimensoes: [1.2, 0.76, 0.8],
    pecas: [caixa(1.2, 0.04, 0.8, 0, 0.72, 0, MADEIRA, 0.5), ...pes(1.2, 0.8, 0.72, 0.06, MADEIRA)],
  },
  {
    chave: 'cadeira',
    nome: 'Cadeira',
    categoria: 'sala',
    dimensoes: [0.45, 0.9, 0.5],
    pecas: [caixa(0.45, 0.04, 0.45, 0, 0.44, 0.025, MADEIRA), caixa(0.45, 0.46, 0.04, 0, 0.44, -0.23, MADEIRA), ...pes(0.45, 0.5, 0.44, 0.04, MADEIRA)],
  },
  {
    chave: 'cama-casal',
    nome: 'Cama de casal',
    categoria: 'quarto',
    dimensoes: [1.6, 1.0, 2.1],
    pecas: [caixa(1.6, 0.3, 2.0, 0, 0, 0.05, MADEIRA, 0.6), caixa(1.58, 0.22, 1.98, 0, 0.3, 0.05, BRANCO, 1), caixa(1.6, 1.0, 0.1, 0, 0, -1.0, MADEIRA, 0.6)],
  },
  {
    chave: 'cama-solteiro',
    nome: 'Cama de solteiro',
    categoria: 'quarto',
    dimensoes: [0.9, 0.9, 2.0],
    pecas: [caixa(0.9, 0.3, 1.92, 0, 0, 0.04, MADEIRA, 0.6), caixa(0.88, 0.2, 1.9, 0, 0.3, 0.04, BRANCO, 1), caixa(0.9, 0.9, 0.08, 0, 0, -0.96, MADEIRA, 0.6)],
  },
  {
    chave: 'guarda-roupa',
    nome: 'Guarda-roupa',
    categoria: 'quarto',
    dimensoes: [1.8, 2.2, 0.6],
    pecas: [caixa(1.8, 2.2, 0.6, 0, 0, 0, BRANCO, 0.5), caixa(0.02, 2.0, 0.01, 0, 0.1, 0.295, '#c9c6bf')],
  },
  {
    chave: 'mesa-cabeceira',
    nome: 'Criado-mudo',
    categoria: 'quarto',
    dimensoes: [0.45, 0.55, 0.4],
    pecas: [caixa(0.45, 0.55, 0.4, 0, 0, 0, MADEIRA, 0.6)],
  },
  {
    chave: 'escrivaninha',
    nome: 'Escrivaninha',
    categoria: 'escritorio',
    dimensoes: [1.2, 0.75, 0.6],
    pecas: [caixa(1.2, 0.04, 0.6, 0, 0.71, 0, BRANCO, 0.5), caixa(0.04, 0.71, 0.6, -0.58, 0, 0, BRANCO), caixa(0.04, 0.71, 0.6, 0.58, 0, 0, BRANCO)],
  },
  {
    chave: 'cozinha-linear',
    nome: 'Armário de cozinha 2 m',
    categoria: 'cozinha',
    dimensoes: [2.0, 2.2, 0.6],
    pecas: [caixa(2.0, 0.87, 0.6, 0, 0, 0, BRANCO, 0.5), caixa(2.0, 0.03, 0.6, 0, 0.87, 0, '#3b3d40', 0.25), caixa(2.0, 0.7, 0.35, 0, 1.5, -0.125, BRANCO, 0.5)],
  },
  {
    chave: 'geladeira',
    nome: 'Geladeira',
    categoria: 'cozinha',
    dimensoes: [0.7, 1.85, 0.7],
    pecas: [caixa(0.7, 1.85, 0.7, 0, 0, 0, '#d7dade', 0.3)],
  },
  {
    chave: 'vaso-planta',
    nome: 'Vaso com planta',
    categoria: 'decoracao',
    dimensoes: [0.6, 1.2, 0.6],
    pecas: [cilindro(0.4, 0.45, 0, 0, 0, '#e7e2d8'), cilindro(0.6, 0.75, 0, 0.45, 0, '#4f7a46')],
  },
  {
    chave: 'espreguicadeira',
    nome: 'Espreguiçadeira',
    categoria: 'externo',
    dimensoes: [0.7, 0.6, 1.9],
    pecas: [caixa(0.7, 0.3, 1.9, 0, 0, 0, BRANCO, 0.6), caixa(0.7, 0.3, 0.6, 0, 0.3, -0.65, BRANCO, 0.6)],
  },
];

export const movelPadrao = (chave: string): MovelPadrao | undefined => MOVEIS_PADRAO.find((m) => m.chave === chave);

/** Caixa real das peças (para conferir com as dimensões declaradas). */
export function caixaDoMovel(m: MovelPadrao): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of m.pecas)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p.posicao[k]! - p.tamanho[k]! / 2);
      max[k] = Math.max(max[k]!, p.posicao[k]! + p.tamanho[k]! / 2);
    }
  return { min, max };
}

/** Posição de um móvel na cena: em metros, com giro em graus em torno do eixo vertical. */
export interface PoseMovel {
  x: number;
  y: number;
  z: number;
  giroGraus: number;
}

/** Arredonda para a grade de 5 cm e o giro para 0–359 (salvar e reabrir dá o mesmo lugar). */
export function ajustarPose(p: PoseMovel): PoseMovel {
  const grade = (v: number) => Math.round(v * 20) / 20;
  return { x: grade(p.x), y: Math.round(p.y * 1000) / 1000, z: grade(p.z), giroGraus: ((Math.round(p.giroGraus) % 360) + 360) % 360 };
}
