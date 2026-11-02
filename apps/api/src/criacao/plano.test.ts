import { describe, expect, it } from 'vitest';
import { distribuir, ordemDeCanto, planoDoPredio, posicionarLazer } from './plano';
import { interpretarDescricao } from './texto';

describe('planoDoPredio', () => {
  it('12 andares × 4 por andar, 2 e 3 quartos: 48 unidades, as maiores nos cantos, sem preço', () => {
    const p = planoDoPredio(interpretarDescricao('12 andares, 4 por andar, 2 e 3 quartos de 62 e 85 m², piscina e academia'))!;
    expect(p.linhas).toHaveLength(48);
    expect(p.linhas.map((l) => l.codigo).slice(0, 4)).toEqual(['101', '102', '103', '104']);
    expect(p.linhas.at(-1)).toMatchObject({ codigo: '1204', andar: 12, predio: 'Torre A' });
    expect(new Set(p.linhas.map((l) => l.preco))).toEqual(new Set([null]));
    // 2 de cada por andar
    const doAndar = p.linhas.filter((l) => l.andar === 1);
    expect(doAndar.filter((l) => l.quartos === 3)).toHaveLength(2);
    expect(doAndar.filter((l) => l.quartos === 2)).toHaveLength(2);
    expect(p.avisos).toEqual([]);
    expect(p.lazer.map((l) => l.categoria)).toEqual(['piscina', 'academia']);
  });

  it('torres repetem o andar-tipo com códigos iguais em prédios diferentes', () => {
    const p = planoDoPredio(interpretarDescricao('2 torres de 5 andares, 2 por andar, 2 quartos de 60 m²'))!;
    expect(p.predios).toEqual(['Torre A', 'Torre B']);
    expect(p.linhas).toHaveLength(20);
    expect(p.linhas.filter((l) => l.codigo === '101').map((l) => l.predio)).toEqual(['Torre A', 'Torre B']);
  });

  it('o que o texto não diz vira aviso; sem andares não há plano', () => {
    expect(planoDoPredio(interpretarDescricao('prédio com piscina'))).toBeNull();
    const p = planoDoPredio(interpretarDescricao('10 andares'))!;
    expect(p.porAndar).toBe(4);
    expect(p.linhas[0]).toMatchObject({ tipologia: '2 quartos', areaM2: 62, quartos: 2 });
    expect(p.avisos).toEqual(['O texto não diz quantas unidades por andar: usei 4.', 'O texto não diz as tipologias: usei 2 quartos.', 'Área de "2 quartos" não veio no texto: usei 62 m² (ajuste nas tipologias).']);
  });

  it('total de unidades sem andares: o plano calcula os andares', () => {
    const p = planoDoPredio(interpretarDescricao('48 unidades, 4 por andar, 1 quarto de 40 m²'))!;
    expect(p.andares).toBe(12);
    expect(p.linhas).toHaveLength(48);
  });

  it('nunca passa do limite da importação', () => {
    expect(planoDoPredio(interpretarDescricao('6 torres de 120 andares, 20 por andar, 2 quartos'))).toBeNull();
  });
});

describe('peças do plano', () => {
  it('cantos primeiro na grade da fachada (4 = 2×2: todos cantos; 6 = 3×2)', () => {
    expect(ordemDeCanto(4)).toEqual([0, 1, 2, 3]);
    expect(ordemDeCanto(6)).toEqual([0, 2, 3, 5, 1, 4]);
  });
  it('distribuição parelha, sobra para as menores', () => {
    expect(distribuir(4, 2)).toEqual([2, 2]);
    expect(distribuir(5, 2)).toEqual([3, 2]);
    expect(distribuir(6, 4)).toEqual([2, 2, 1, 1]);
  });
  it('lazer fora do prédio no térreo e o rooftop no terraço', () => {
    const l = posicionarLazer(
      [
        { categoria: 'piscina', nome: 'Piscina' },
        { categoria: 'outro', nome: 'Rooftop' },
        { categoria: 'academia', nome: 'Academia' },
      ],
      4,
      10,
    );
    expect(l[1]).toMatchObject({ x: 0, y: 30, z: 0, ordem: 1 });
    for (const p of [l[0]!, l[2]!]) {
      expect(p.y).toBe(0);
      // fora da caixa do prédio (16 × 16 m centrada)
      expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeGreaterThan(8);
    }
    expect(l[0]!.x).not.toBe(l[2]!.x);
  });
});
