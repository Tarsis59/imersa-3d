import { describe, expect, it } from 'vitest';
import { construirArvores, escolherEspecie, type DescricaoArvore } from './vegetacao';

describe('espécie da árvore pela posição (Plano 12a, item 8)', () => {
  it('é sempre a mesma espécie para a mesma posição', () => {
    const pontos: ReadonlyArray<readonly [number, number]> = [
      [10, 20],
      [-5, 3],
      [0, 0],
      [123.4, -56.7],
    ];
    for (const [x, z] of pontos) expect(escolherEspecie(x, z)).toBe(escolherEspecie(x, z));
  });

  it('só devolve espécies conhecidas', () => {
    const conhecidas = new Set(['nativa', 'ipe-amarelo', 'ipe-rosa', 'palmeira']);
    for (let i = 0; i < 200; i++) expect(conhecidas.has(escolherEspecie(i * 3.7, i * -1.9))).toBe(true);
  });

  it('varia: numa amostra grande aparecem as 4 espécies', () => {
    const vistas = new Set<string>();
    for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++) vistas.add(escolherEspecie(x * 4.3, z * 2.1));
    expect(vistas.size).toBe(4);
  });
});

describe('montagem das árvores por espécie', () => {
  const base: Omit<DescricaoArvore, 'especie'> = { x: 0, y: 0, z: 0, altura: 6, raio: 2, tom: 0.4 };

  it('nativa e ipê compartilham tronco e copa redonda: 1 malha de tronco e 1 de copa só', () => {
    const arvores: DescricaoArvore[] = [
      { ...base, x: 0, especie: 'nativa' },
      { ...base, x: 5, especie: 'ipe-amarelo' },
      { ...base, x: 10, especie: 'ipe-rosa' },
    ];
    const r = construirArvores(arvores, () => undefined);
    expect(r.malhas.length).toBe(2); // tronco + copa (sem palmeira no grupo)
    expect(r.malhas[0]!.count).toBe(3);
    expect(r.malhas[1]!.count).toBe(3);
    r.destruir();
  });

  it('palmeira tem geometria própria, à parte da copa redonda', () => {
    const arvores: DescricaoArvore[] = [
      { ...base, x: 0, especie: 'nativa' },
      { ...base, x: 5, especie: 'palmeira' },
      { ...base, x: 10, especie: 'palmeira' },
    ];
    const r = construirArvores(arvores, () => undefined);
    expect(r.malhas.length).toBe(4); // tronco+copa da nativa, tronco+folhas da palmeira
    const contagens = r.malhas.map((m) => m.count).sort();
    expect(contagens).toEqual([1, 1, 2, 2]);
    r.destruir();
  });

  it('sem árvore nenhuma: nenhuma malha, sem erro', () => {
    const r = construirArvores([], () => undefined);
    expect(r.malhas.length).toBe(0);
    r.destruir();
  });

  it('chama `preparar` para cada material criado (CSM etc.)', () => {
    let chamadas = 0;
    const arvores: DescricaoArvore[] = [{ ...base, especie: 'palmeira' }];
    const r = construirArvores(arvores, () => void chamadas++);
    expect(chamadas).toBe(r.materiais.length);
    expect(chamadas).toBeGreaterThan(0);
    r.destruir();
  });
});
