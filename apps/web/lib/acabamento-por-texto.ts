import type { CategoriaMaterial, Material } from './configurador';
import { distanciaDeCor } from './estilos';
import { normalizar } from './comandos';

/**
 * Comandos do configurador (Plano 11e, item 21): "piso de madeira na sala, parede verde no quarto". Lê o pedido e
 * escolhe, no catálogo da empresa, o material mais próximo para as superfícies do cômodo. Nada é inventado: só
 * entra material que existe e está ativo no catálogo.
 */
export interface PedidoAcabamento {
  categoria: Extract<CategoriaMaterial, 'piso' | 'parede' | 'teto' | 'bancada'>;
  /** Cômodo pedido ("sala", "quarto"...); null = todas as superfícies dessa categoria. */
  comodo: string | null;
  padrao: Material['padrao'] | null;
  cor: string | null;
  /** Como a pessoa disse (para a mensagem). */
  frase: string;
}

const CATEGORIAS: Array<[RegExp, PedidoAcabamento['categoria']]> = [
  [/\b(piso|chao|assoalho)\b/, 'piso'],
  [/\b(parede|paredes|pintura)\b/, 'parede'],
  [/\b(teto|forro)\b/, 'teto'],
  [/\b(bancada|pia|tampo)\b/, 'bancada'],
];
const PADROES: Array<[RegExp, Material['padrao']]> = [
  [/\b(madeira|taco|laminado|vinilico amadeirado|amadeirado)\b/, 'madeira'],
  [/\bporcelanato\b/, 'porcelanato'],
  [/\bmarmore\b/, 'marmore'],
  [/\b(cimento|cimento queimado|concreto)\b/, 'cimento'],
  [/\b(tijolo|tijolinho)\b/, 'tijolo'],
  [/\bpastilhas?\b/, 'pastilha'],
  [/\b(liso|lisa|pintad[ao])\b/, 'liso'],
];
const CORES: Record<string, string> = {
  branco: '#f2f1ec', branca: '#f2f1ec', cinza: '#8a8d91', preto: '#232323', preta: '#232323', bege: '#d8c8a8', areia: '#d6c7a6',
  verde: '#5f8a5a', azul: '#4a6f9e', amarelo: '#e2c050', amarela: '#e2c050', vermelho: '#a8443c', vermelha: '#a8443c', rosa: '#d9a0a8',
  marrom: '#7a5236', terracota: '#b5643c', grafite: '#4a4c50', off: '#ece6da', creme: '#efe3c8', lilas: '#b6a2c9', laranja: '#d98a3d',
};
const COMODOS = ['sala', 'quarto', 'suite', 'cozinha', 'banheiro', 'varanda', 'lavanderia', 'escritorio', 'corredor', 'jantar', 'area de servico'];

export function lerPedidosAcabamento(texto: string): PedidoAcabamento[] {
  const n = normalizar(texto.slice(0, 400));
  const saida: PedidoAcabamento[] = [];
  for (const frase of n.split(/\s*(?:,|;|\.|\be\b(?=\s+(?:o\s+|a\s+)?(?:piso|parede|paredes|teto|bancada|chao)))\s*/).filter(Boolean)) {
    const categoria = CATEGORIAS.find(([re]) => re.test(frase))?.[1];
    if (!categoria) continue;
    const padrao = PADROES.find(([re]) => re.test(frase))?.[1] ?? null;
    const corNome = Object.keys(CORES).find((c) => new RegExp(`\\b${c}s?\\b`).test(frase));
    const comodo = COMODOS.find((c) => new RegExp(`\\b${c}s?\\b`).test(frase)) ?? null;
    if (!padrao && !corNome) continue;
    saida.push({ categoria, comodo, padrao, cor: corNome ? CORES[corNome]! : null, frase });
  }
  return saida;
}

/** Superfícies do pedido: a categoria certa e, se pediu cômodo, o nome dela tem o cômodo. */
export function superficiesDoPedido(p: PedidoAcabamento, superficies: ReadonlyArray<{ chave: string; rotulo: string; categoria: CategoriaMaterial }>): string[] {
  return superficies.filter((s) => s.categoria === p.categoria && (!p.comodo || normalizar(s.rotulo).includes(p.comodo))).map((s) => s.chave);
}

/** O material ativo do catálogo que mais se parece com o pedido (padrão primeiro, depois a cor). */
export function materialDoPedido(p: PedidoAcabamento, materiais: readonly Material[]): Material | null {
  let melhor: { m: Material; nota: number } | null = null;
  for (const m of materiais) {
    if (!m.ativo || m.categoria !== p.categoria) continue;
    let nota = 0;
    if (p.padrao) nota += m.padrao === p.padrao || normalizar(m.nome).includes(p.padrao) ? 0 : 1000;
    if (p.cor) nota += distanciaDeCor(m.cor, p.cor);
    if (!melhor || nota < melhor.nota) melhor = { m, nota };
  }
  // padrão pedido que o catálogo não tem: melhor não trocar do que trocar errado
  if (melhor && p.padrao && melhor.nota >= 1000) return null;
  return melhor?.m ?? null;
}
