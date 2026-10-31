import { describe, it, expect } from 'vitest';
import { sugerirVinculos } from './vinculo-bim';

// ambientes da casa FZK (IFC4 de exemplo)
const FZK = [
  { guid: 'g1', nome: '1', nome_longo: 'Flur' },
  { guid: 'g4', nome: '4', nome_longo: 'Schlafzimmer' },
  { guid: 'g6', nome: '6', nome_longo: 'Küche' },
  { guid: 'g7', nome: '7', nome_longo: 'Galerie' },
];

describe('vínculo automático ambiente ↔ unidade', () => {
  it('por código igual e por número único; sem correspondência segura fica para o ajuste manual', () => {
    const s = sugerirVinculos(FZK, [
      { id: 'u1', codigo: '4' },
      { id: 'u2', codigo: 'Apto 7' },
      { id: 'u3', codigo: 'Cozinha' },
      { id: 'u4', codigo: '99' },
      { id: 'u5', codigo: 'kuche' },
    ]);
    expect(s).toEqual(
      expect.arrayContaining([
        { unidadeId: 'u1', espacoGuid: 'g4', motivo: 'codigo' },
        { unidadeId: 'u2', espacoGuid: 'g7', motivo: 'numero' },
        { unidadeId: 'u5', espacoGuid: 'g6', motivo: 'codigo' }, // acento e maiúscula não atrapalham
      ]),
    );
    expect(s.map((x) => x.unidadeId)).not.toContain('u3');
    expect(s.map((x) => x.unidadeId)).not.toContain('u4');
  });

  it('um ambiente nunca vai para duas unidades; zeros à esquerda não importam', () => {
    const s = sugerirVinculos(
      [
        { guid: 'a', nome: '101', nome_longo: null },
        { guid: 'b', nome: 'Apto 0102', nome_longo: null },
      ],
      [
        { id: 'x', codigo: '101' },
        { id: 'y', codigo: 'Apto 101' },
        { id: 'z', codigo: '102' },
      ],
    );
    expect(s.filter((v) => v.espacoGuid === 'a')).toHaveLength(1);
    expect(s.find((v) => v.unidadeId === 'z')?.espacoGuid).toBe('b');
  });
});
