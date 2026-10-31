import { describe, it, expect } from 'vitest';
import { calcularOrcamento } from './orcamento';
import { LICENCA_MOVEIS_PADRAO, MATERIAIS_INICIAIS, MOVEIS_INICIAIS } from './catalogo-inicial';
// a lista do visualizador é a fonte dos modelos; a API só precisa de chave, nome e categoria
import { LICENCA_PADRAO, MOVEIS_PADRAO } from '../../../../packages/viewer/src/configurador/moveis';

const mat = new Map([
  ['m1', { id: 'm1', nome: 'Porcelanato', precoM2: 89.9 }],
  ['m2', { id: 'm2', nome: 'Pintura', precoM2: null }],
]);
const mov = new Map([
  ['c', { id: 'c', nome: 'Cadeira', preco: 349.99 }],
  ['s', { id: 's', nome: 'Sofá', preco: null }],
]);

describe('orçamento do configurador', () => {
  it('área × preço por m² em centavos inteiros; superfície sem material não entra', () => {
    const o = calcularOrcamento(
      [
        { chave: 'pisos', rotulo: 'Pisos', areaM2: 12.345, materialId: 'm1' },
        { chave: 'paredes', rotulo: 'Paredes', areaM2: 40, materialId: null },
      ],
      [],
      mat,
      mov,
    );
    // 12,35 m² × R$ 89,90 = R$ 1.110,265 → 1.110,27 (arredonda o centavo uma vez só)
    expect(o).toEqual({ linhas: [{ tipo: 'superficie', descricao: 'Pisos', item: 'Porcelanato', quantidade: 12.35, unidade: 'm²', precoUnitario: 89.9, valor: 1110.27 }], total: 1110.27, semPreco: 0 });
  });

  it('móveis iguais viram uma linha com quantidade; sem preço entra marcado e não soma', () => {
    const o = calcularOrcamento([{ chave: 'paredes', rotulo: 'Paredes', areaM2: 10, materialId: 'm2' }], [{ movelId: 'c' }, { movelId: 's' }, { movelId: 'c' }], mat, mov);
    expect(o.linhas.map((l) => [l.item, l.quantidade, l.valor])).toEqual([
      ['Pintura', 10, 0],
      ['Cadeira', 2, 699.98],
      ['Sofá', 1, 0],
    ]);
    expect(o.total).toBe(699.98);
    expect(o.semPreco).toBe(2);
  });

  it('soma de muitos centavos não acumula erro de ponto flutuante', () => {
    const o = calcularOrcamento([], Array.from({ length: 10 }, () => ({ movelId: 'x' })), mat, new Map([['x', { id: 'x', nome: 'Banqueta', preco: 0.1 }]]));
    expect(o.total).toBe(1);
  });

  it('material ou móvel fora do catálogo é erro (a API valida antes)', () => {
    expect(() => calcularOrcamento([{ chave: 'a', rotulo: 'A', areaM2: 1, materialId: 'zz' }], [], mat, mov)).toThrow(/fora do catálogo/);
    expect(() => calcularOrcamento([], [{ movelId: 'zz' }], mat, mov)).toThrow(/fora do catálogo/);
  });
});

describe('catálogos iniciais', () => {
  it('materiais sem preço (preço é da construtora), nomes únicos e cores válidas', () => {
    expect(MATERIAIS_INICIAIS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(MATERIAIS_INICIAIS.map((m) => m.nome)).size).toBe(MATERIAIS_INICIAIS.length);
    for (const m of MATERIAIS_INICIAIS) {
      expect(m.cor, m.nome).toMatch(/^#[0-9a-f]{6}$/);
      expect('preco' in m || 'precoM2' in m, m.nome).toBe(false);
    }
    for (const c of ['piso', 'parede', 'teto', 'telhado', 'esquadria', 'bancada']) expect(MATERIAIS_INICIAIS.some((m) => m.categoria === c), c).toBe(true);
  });

  it('os móveis padrão da API são exatamente os do visualizador, com a mesma licença', () => {
    expect(MOVEIS_INICIAIS).toEqual(MOVEIS_PADRAO.map((m) => ({ chave: m.chave, nome: m.nome, categoria: m.categoria })));
    expect(LICENCA_MOVEIS_PADRAO).toEqual(LICENCA_PADRAO);
  });
});
