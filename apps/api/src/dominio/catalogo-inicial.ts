/**
 * Catálogos de partida (botão "Adicionar catálogo inicial"): acabamentos comuns em lançamentos e os móveis padrão
 * do visualizador. Os materiais vêm SEM preço: preço é da construtora (fornecedor, região, negociação), e um número
 * inventado viraria orçamento errado na mão da cliente.
 */
export interface MaterialInicial {
  nome: string;
  categoria: 'piso' | 'parede' | 'teto' | 'telhado' | 'esquadria' | 'bancada' | 'outro';
  padrao: 'liso' | 'madeira' | 'porcelanato' | 'marmore' | 'cimento' | 'tijolo' | 'pastilha';
  cor: string;
  cor2?: string;
  rugosidade: number;
  metalico?: number;
  escalaM: number;
}

export const MATERIAIS_INICIAIS: readonly MaterialInicial[] = [
  { nome: 'Porcelanato acetinado areia 60×60', categoria: 'piso', padrao: 'porcelanato', cor: '#d8cfbf', rugosidade: 0.45, escalaM: 0.6 },
  { nome: 'Porcelanato polido branco 90×90', categoria: 'piso', padrao: 'porcelanato', cor: '#efeeea', rugosidade: 0.15, escalaM: 0.9 },
  { nome: 'Porcelanato cimentício grafite 60×120', categoria: 'piso', padrao: 'cimento', cor: '#6b6d6e', rugosidade: 0.6, escalaM: 1.2 },
  { nome: 'Vinílico carvalho natural', categoria: 'piso', padrao: 'madeira', cor: '#b98d5f', rugosidade: 0.55, escalaM: 0.8 },
  { nome: 'Laminado nogueira', categoria: 'piso', padrao: 'madeira', cor: '#7a5434', rugosidade: 0.5, escalaM: 0.8 },
  { nome: 'Mármore Carrara', categoria: 'piso', padrao: 'marmore', cor: '#eceae6', cor2: '#9aa0a6', rugosidade: 0.2, escalaM: 1.2 },
  { nome: 'Pintura acrílica branco neve', categoria: 'parede', padrao: 'liso', cor: '#f4f3ef', rugosidade: 0.9, escalaM: 1 },
  { nome: 'Pintura acrílica cinza urbano', categoria: 'parede', padrao: 'liso', cor: '#a9aaa6', rugosidade: 0.9, escalaM: 1 },
  { nome: 'Pintura acrílica verde sálvia', categoria: 'parede', padrao: 'liso', cor: '#9fae94', rugosidade: 0.9, escalaM: 1 },
  { nome: 'Tijolinho aparente', categoria: 'parede', padrao: 'tijolo', cor: '#a65a3c', cor2: '#d9cfc3', rugosidade: 0.95, escalaM: 0.5 },
  { nome: 'Cimento queimado', categoria: 'parede', padrao: 'cimento', cor: '#9c9a95', rugosidade: 0.75, escalaM: 1.5 },
  { nome: 'Pastilha de vidro azul', categoria: 'parede', padrao: 'pastilha', cor: '#4f86a6', rugosidade: 0.2, escalaM: 0.3 },
  { nome: 'Forro de gesso branco', categoria: 'teto', padrao: 'liso', cor: '#f6f5f2', rugosidade: 0.95, escalaM: 1 },
  { nome: 'Telha cerâmica natural', categoria: 'telhado', padrao: 'tijolo', cor: '#b5643f', cor2: '#7d3f25', rugosidade: 0.85, escalaM: 0.4 },
  { nome: 'Telha metálica cinza', categoria: 'telhado', padrao: 'liso', cor: '#8a8f94', rugosidade: 0.4, metalico: 0.7, escalaM: 1 },
  { nome: 'Esquadria de alumínio preto', categoria: 'esquadria', padrao: 'liso', cor: '#2b2c2e', rugosidade: 0.35, metalico: 0.8, escalaM: 1 },
  { nome: 'Esquadria de alumínio branco', categoria: 'esquadria', padrao: 'liso', cor: '#eeeeec', rugosidade: 0.35, metalico: 0.6, escalaM: 1 },
  { nome: 'Granito preto São Gabriel', categoria: 'bancada', padrao: 'marmore', cor: '#2a2a2c', cor2: '#6f6f72', rugosidade: 0.15, escalaM: 1 },
  { nome: 'Quartzo branco', categoria: 'bancada', padrao: 'liso', cor: '#f1f0ec', rugosidade: 0.2, escalaM: 1 },
];

/**
 * Móveis padrão do visualizador (`packages/viewer/src/configurador/moveis.ts`): chave, nome e categoria. Um teste
 * confere que as duas listas são a mesma.
 */
export const MOVEIS_INICIAIS: ReadonlyArray<{ chave: string; nome: string; categoria: 'sala' | 'quarto' | 'cozinha' | 'banheiro' | 'escritorio' | 'externo' | 'decoracao' }> = [
  { chave: 'sofa-3', nome: 'Sofá 3 lugares', categoria: 'sala' },
  { chave: 'poltrona', nome: 'Poltrona', categoria: 'sala' },
  { chave: 'rack-tv', nome: 'Rack com TV', categoria: 'sala' },
  { chave: 'mesa-centro', nome: 'Mesa de centro', categoria: 'sala' },
  { chave: 'tapete', nome: 'Tapete 2 × 1,4 m', categoria: 'decoracao' },
  { chave: 'mesa-4', nome: 'Mesa de jantar 4 lugares', categoria: 'sala' },
  { chave: 'cadeira', nome: 'Cadeira', categoria: 'sala' },
  { chave: 'cama-casal', nome: 'Cama de casal', categoria: 'quarto' },
  { chave: 'cama-solteiro', nome: 'Cama de solteiro', categoria: 'quarto' },
  { chave: 'guarda-roupa', nome: 'Guarda-roupa', categoria: 'quarto' },
  { chave: 'mesa-cabeceira', nome: 'Criado-mudo', categoria: 'quarto' },
  { chave: 'escrivaninha', nome: 'Escrivaninha', categoria: 'escritorio' },
  { chave: 'cozinha-linear', nome: 'Armário de cozinha 2 m', categoria: 'cozinha' },
  { chave: 'geladeira', nome: 'Geladeira', categoria: 'cozinha' },
  { chave: 'vaso-planta', nome: 'Vaso com planta', categoria: 'decoracao' },
  { chave: 'espreguicadeira', nome: 'Espreguiçadeira', categoria: 'externo' },
];
export const LICENCA_MOVEIS_PADRAO = { licenca: 'Própria (Imersa 3D)', autor: 'Imersa 3D' } as const;
