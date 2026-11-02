import { describe, expect, it } from 'vitest';
import { distanciaDeCor, escolhasDoEstilo, LISTA_ESTILOS } from './estilos';
import type { Material } from './configurador';

// o catálogo inicial que a empresa recebe (mesmos desenhos e cores)
const BASE = { cor2: null, rugosidade: 0.5, metalico: 0, escalaM: 1, precoM2: null, fornecedor: null, codigo: null, ativo: true };
const CATALOGO: Material[] = (
  [
    ['Porcelanato acetinado areia', 'piso', 'porcelanato', '#d8cfbf'],
    ['Porcelanato polido branco', 'piso', 'porcelanato', '#efeeea'],
    ['Porcelanato cimentício grafite', 'piso', 'cimento', '#6b6d6e'],
    ['Vinílico carvalho natural', 'piso', 'madeira', '#b98d5f'],
    ['Laminado nogueira', 'piso', 'madeira', '#7a5434'],
    ['Mármore Carrara', 'piso', 'marmore', '#eceae6'],
    ['Pintura branco neve', 'parede', 'liso', '#f4f3ef'],
    ['Pintura cinza urbano', 'parede', 'liso', '#a9aaa6'],
    ['Pintura verde sálvia', 'parede', 'liso', '#9fae94'],
    ['Tijolinho aparente', 'parede', 'tijolo', '#a65a3c'],
    ['Cimento queimado', 'parede', 'cimento', '#9c9a95'],
    ['Pastilha de vidro azul', 'parede', 'pastilha', '#4f86a6'],
    ['Telha cerâmica natural', 'telhado', 'tijolo', '#b5643f'],
    ['Telha metálica cinza', 'telhado', 'liso', '#8a8f94'],
    ['Esquadria preta', 'esquadria', 'liso', '#2b2c2e'],
    ['Esquadria branca', 'esquadria', 'liso', '#eeeeec'],
    ['Granito preto', 'bancada', 'marmore', '#2a2a2c'],
    ['Quartzo branco', 'bancada', 'liso', '#f1f0ec'],
  ] as const
).map(([nome, categoria, padrao, cor]) => ({ ...BASE, id: nome, nome, categoria, padrao, cor }));

const SUPERFICIES = [
  { chave: 'pisos', categoria: 'piso' },
  { chave: 'paredes', categoria: 'parede' },
  { chave: 'telhado', categoria: 'telhado' },
  { chave: 'esquadrias', categoria: 'esquadria' },
  { chave: 'bancadas', categoria: 'bancada' },
  { chave: 'outros', categoria: 'outro' },
] as const;

describe('decoração com um toque', () => {
  it('cada estilo escolhe do catálogo o que combina com ele', () => {
    expect(escolhasDoEstilo('moderno', SUPERFICIES, CATALOGO)).toEqual({
      pisos: 'Porcelanato cimentício grafite',
      paredes: 'Pintura cinza urbano',
      telhado: 'Telha metálica cinza',
      esquadrias: 'Esquadria preta',
      bancadas: 'Granito preto',
    });
    expect(escolhasDoEstilo('classico', SUPERFICIES, CATALOGO)).toEqual({
      pisos: 'Mármore Carrara',
      paredes: 'Pintura branco neve',
      telhado: 'Telha cerâmica natural',
      esquadrias: 'Esquadria branca',
      bancadas: 'Quartzo branco',
    });
    expect(escolhasDoEstilo('jovem', SUPERFICIES, CATALOGO)).toMatchObject({ pisos: 'Vinílico carvalho natural', paredes: 'Pintura verde sálvia', esquadrias: 'Esquadria preta' });
  });

  it('os três estilos ficam diferentes entre si', () => {
    const [a, b, c] = LISTA_ESTILOS.map((e) => JSON.stringify(escolhasDoEstilo(e, SUPERFICIES, CATALOGO)));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('usa o que a empresa tem: sem o desenho preferido, vai o mais parecido; inativo e outra categoria não entram', () => {
    const semMarmore = CATALOGO.filter((m) => m.padrao !== 'marmore');
    expect(escolhasDoEstilo('classico', [{ chave: 'pisos', categoria: 'piso' }], semMarmore).pisos).toBe('Porcelanato polido branco');
    const inativo = CATALOGO.map((m) => (m.id === 'Mármore Carrara' ? { ...m, ativo: false } : m));
    expect(escolhasDoEstilo('classico', [{ chave: 'pisos', categoria: 'piso' }], inativo).pisos).toBe('Porcelanato polido branco');
    // superfície sem material da categoria: continua como estava (não recebe parede no piso)
    expect(escolhasDoEstilo('moderno', [{ chave: 'pisos', categoria: 'piso' }], CATALOGO.filter((m) => m.categoria !== 'piso'))).toEqual({});
  });

  it('distância de cor: igual é zero, preto e branco é o máximo', () => {
    expect(distanciaDeCor('#123456', '#123456')).toBe(0);
    expect(distanciaDeCor('#000000', '#ffffff')).toBeCloseTo(255, 0);
  });
});
