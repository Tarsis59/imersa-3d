import { describe, it, expect } from 'vitest';
import { layoutMarca, textoDaMarca } from './marca';

describe('faixa da marca na imagem', () => {
  it('proporcional à altura, com mínimo e máximo, em pixels inteiros', () => {
    const m = layoutMarca(1280, 720);
    expect(m.alturaFaixa).toBe(58);
    expect(m.alturaTotal).toBe(720 + 58);
    expect(Number.isInteger(m.fonte) && Number.isInteger(m.margem)).toBe(true);
    expect(layoutMarca(300, 200).alturaFaixa).toBe(40);
    expect(layoutMarca(4000, 3000).alturaFaixa).toBe(120);
  });

  it('fonte menor em imagem estreita (o texto cabe no celular)', () => {
    expect(layoutMarca(390, 700).fonte).toBeLessThan(layoutMarca(1440, 700).fonte);
  });

  it('textos: empresa e prédio à esquerda; aviso e data à direita; atribuição do OSM quando há entorno', () => {
    const t = textoDaMarca({ empresa: 'Construtora X', predio: 'Torre A', data: new Date('2026-06-21T15:00:00-03:00'), atribuicao: '© colaboradores do OpenStreetMap (ODbL)' });
    expect(t.esquerda).toBe('Construtora X · Torre A');
    expect(t.direita).toBe('Imagem ilustrativa · 21/06/2026');
    expect(t.rodape).toBe('© colaboradores do OpenStreetMap (ODbL)');
    expect(textoDaMarca({ empresa: 'X', predio: 'Y', data: new Date('2026-01-02T12:00:00-03:00') }).rodape).toBeNull();
  });
});
