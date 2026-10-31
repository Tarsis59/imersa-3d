import { describe, it, expect } from 'vitest';
import { acabamentoDe, m2, materiaisPara, numeroBr, previaOrcamento, type Material, type Movel } from './configurador';

const base: Omit<Material, 'id' | 'nome' | 'categoria' | 'precoM2'> = { padrao: 'liso', cor: '#ffffff', cor2: null, rugosidade: 0.9, metalico: 0, escalaM: 1, fornecedor: null, codigo: null, ativo: true };
const porcelanato: Material = { ...base, id: 'p', nome: 'Porcelanato', categoria: 'piso', padrao: 'porcelanato', escalaM: 0.6, precoM2: 89.9 };
const pintura: Material = { ...base, id: 't', nome: 'Pintura', categoria: 'parede', precoM2: null };
const cadeira: Movel = { id: 'c', nome: 'Cadeira', categoria: 'sala', modeloPadrao: 'cadeira', arquivoId: null, arquivoNome: null, preco: 349.99, licenca: 'x', autor: 'x', fonteUrl: null, ativo: true };
const pose = { x: 0, y: 0, z: 0, giroGraus: 0 };

describe('configurador (site)', () => {
  it('prévia do orçamento: mesma conta da API (centavos), sem preço marcado', () => {
    const o = previaOrcamento(
      [
        { chave: 'pisos', rotulo: 'Pisos', areaM2: 12.345, materialId: 'p' },
        { chave: 'paredes', rotulo: 'Paredes', areaM2: 30, materialId: 't' },
        { chave: 'telhado', rotulo: 'Telhado', areaM2: 30, materialId: null },
      ],
      [
        { instanciaId: 'a', movelId: 'c', pose },
        { instanciaId: 'b', movelId: 'c', pose },
      ],
      [porcelanato, pintura],
      [cadeira],
    );
    expect(o.linhas.map((l) => [l.item, l.quantidade, l.valor])).toEqual([
      ['Porcelanato', 12.35, 1110.27],
      ['Pintura', 30, 0],
      ['Cadeira', 2, 699.98],
    ]);
    expect(o.total).toBe(1810.25);
    expect(o.semPreco).toBe(1);
  });

  it('materiais da categoria da superfície; sem nenhum, todos', () => {
    expect(materiaisPara({ categoria: 'piso' }, [porcelanato, pintura])).toEqual([porcelanato]);
    expect(materiaisPara({ categoria: 'telhado' }, [porcelanato, pintura])).toEqual([porcelanato, pintura]);
  });

  it('acabamento para o 3D e m² legível', () => {
    expect(acabamentoDe(porcelanato)).toEqual({ padrao: 'porcelanato', cor: '#ffffff', cor2: null, rugosidade: 0.9, metalico: 0, escalaM: 0.6 });
    expect(m2(1234.5)).toBe('1.234,50 m²');
  });

  it('número em português', () => {
    expect(numeroBr('1.234,56')).toBe(1234.56);
    expect(numeroBr('0,6')).toBe(0.6);
    expect(numeroBr('0.6')).toBe(0.6);
    expect(numeroBr('  ')).toBeNull();
    expect(numeroBr('abc')).toBeNaN();
  });
});
