import { describe, expect, it } from 'vitest';
import type { Material } from './configurador';
import { lerPedidosAcabamento, materialDoPedido, superficiesDoPedido } from './acabamento-por-texto';

const mat = (id: string, categoria: Material['categoria'], padrao: Material['padrao'], cor: string, ativo = true): Material => ({
  id, nome: id, categoria, padrao, cor, cor2: null, rugosidade: 0.5, metalico: 0, escalaM: 1, precoM2: null, fornecedor: null, codigo: null, ativo,
});
const CATALOGO = [
  mat('piso-carvalho', 'piso', 'madeira', '#a9825a'),
  mat('piso-ipe', 'piso', 'madeira', '#6b4a32'),
  mat('piso-porcelanato-cinza', 'piso', 'porcelanato', '#9a9a98'),
  mat('piso-marmore', 'piso', 'marmore', '#ece9e2'),
  mat('parede-verde', 'parede', 'liso', '#5f8a5a'),
  mat('parede-branca', 'parede', 'liso', '#f3f2ee'),
  mat('parede-azul', 'parede', 'liso', '#4a6f9e'),
  mat('parede-tijolo', 'parede', 'tijolo', '#a0583a'),
  mat('bancada-marmore', 'bancada', 'marmore', '#f0ede6'),
  mat('bancada-granito-preto', 'bancada', 'liso', '#262626'),
  mat('parede-amarela-inativa', 'parede', 'liso', '#e2c050', false),
];
const SUPERFICIES = [
  { chave: 'piso-sala', rotulo: 'Piso da sala', categoria: 'piso' as const },
  { chave: 'piso-quarto', rotulo: 'Piso do quarto', categoria: 'piso' as const },
  { chave: 'parede-sala', rotulo: 'Paredes da sala', categoria: 'parede' as const },
  { chave: 'parede-quarto', rotulo: 'Paredes do quarto', categoria: 'parede' as const },
  { chave: 'bancada-cozinha', rotulo: 'Bancada da cozinha', categoria: 'bancada' as const },
];
const troca = (texto: string) =>
  lerPedidosAcabamento(texto).flatMap((p) => {
    const m = materialDoPedido(p, CATALOGO);
    return superficiesDoPedido(p, SUPERFICIES).map((s) => `${s}=${m?.id ?? 'nada'}`);
  });

describe('acabamento por texto (10 pedidos)', () => {
  it.each([
    ['piso de madeira na sala', ['piso-sala=piso-carvalho']],
    ['parede verde no quarto', ['parede-quarto=parede-verde']],
    ['piso de madeira na sala, parede verde no quarto', ['piso-sala=piso-carvalho', 'parede-quarto=parede-verde']],
    ['madeira escura no piso do quarto', ['piso-quarto=piso-carvalho']],
    ['porcelanato cinza no piso', ['piso-sala=piso-porcelanato-cinza', 'piso-quarto=piso-porcelanato-cinza']],
    ['paredes brancas na sala', ['parede-sala=parede-branca']],
    ['parede de tijolinho na sala', ['parede-sala=parede-tijolo']],
    ['bancada de mármore na cozinha', ['bancada-cozinha=bancada-marmore']],
    ['bancada preta', ['bancada-cozinha=bancada-granito-preto']],
    ['parede azul no quarto e piso de mármore na sala', ['parede-quarto=parede-azul', 'piso-sala=piso-marmore']],
  ])('%s', (texto, esperado) => expect(troca(texto)).toEqual(esperado));

  it('material inativo não entra; padrão que o catálogo não tem não troca', () => {
    const amarela = troca('parede amarela no quarto');
    expect(amarela).toHaveLength(1);
    expect(amarela[0]).not.toBe('parede-quarto=parede-amarela-inativa');
    expect(troca('piso de cimento queimado na sala')).toEqual(['piso-sala=nada']);
    expect(troca('quero uma cozinha bonita')).toEqual([]);
  });
});
