import { describe, it, expect, vi } from 'vitest';
import { categorizar, consultaOverpass, espacar, interpretarNominatim, interpretarOverpass } from './osm';

describe('categorias de pontos de interesse', () => {
  it.each([
    [{ amenity: 'school' }, 'escola'],
    [{ amenity: 'university' }, 'escola'],
    [{ amenity: 'hospital' }, 'saude'],
    [{ amenity: 'clinic' }, 'saude'],
    [{ amenity: 'pharmacy' }, 'farmacia'],
    [{ shop: 'supermarket' }, 'mercado'],
    [{ railway: 'station' }, 'transporte'],
    [{ public_transport: 'station' }, 'transporte'],
    [{ leisure: 'park' }, 'parque'],
    [{ amenity: 'bench' }, null],
  ])('%j → %s', (tags, esperado) => expect(categorizar(tags as Record<string, string>)).toBe(esperado));
});

describe('Overpass', () => {
  it('monta a consulta com raio e coordenadas', () => {
    const q = consultaOverpass(-23.56175, -46.6545, 1000);
    expect(q).toContain('[out:json]');
    expect(q).toContain('(around:1000,-23.56175,-46.6545)');
    expect(q).toContain('out center tags;');
  });

  it('interpreta nós e áreas (centro), ignora sem nome, sem categoria ou repetidos', () => {
    const r = interpretarOverpass({
      elements: [
        { type: 'node', id: 1, lat: -23.5614, lon: -46.6564, tags: { railway: 'station', name: 'Trianon-MASP' } },
        { type: 'way', id: 2, center: { lat: -23.5636, lon: -46.6585 }, tags: { leisure: 'park', name: 'Parque Trianon' } },
        { type: 'node', id: 3, lat: -23.56, lon: -46.65, tags: { amenity: 'school' } },
        { type: 'node', id: 4, lat: -23.56, lon: -46.65, tags: { amenity: 'bench', name: 'Banco' } },
        { type: 'node', id: 1, lat: -23.5614, lon: -46.6564, tags: { railway: 'station', name: 'Trianon-MASP' } },
        { type: 'way', id: 5, tags: { shop: 'supermarket', name: 'Sem centro' } },
      ],
    });
    expect(r).toEqual([
      { osmId: 'node/1', categoria: 'transporte', nome: 'Trianon-MASP', lat: -23.5614, lon: -46.6564 },
      { osmId: 'way/2', categoria: 'parque', nome: 'Parque Trianon', lat: -23.5636, lon: -46.6585 },
    ]);
  });

  it('resposta estranha vira lista vazia', () => {
    expect(interpretarOverpass(null)).toEqual([]);
    expect(interpretarOverpass({ elements: 'x' })).toEqual([]);
  });
});

describe('Nominatim', () => {
  it('converte resultados', () => {
    expect(interpretarNominatim([{ display_name: 'Avenida Paulista, São Paulo', lat: '-23.5613', lon: '-46.6565' }, { display_name: 'ruim', lat: 'x', lon: '1' }])).toEqual([
      { rotulo: 'Avenida Paulista, São Paulo', lat: -23.5613, lon: -46.6565 },
    ]);
    expect(interpretarNominatim({ erro: 1 })).toEqual([]);
  });
});

describe('fila com intervalo mínimo (regra de uso do Nominatim)', () => {
  it('espaça as chamadas (relógio simulado: determinístico mesmo com a máquina carregada)', async () => {
    vi.useFakeTimers();
    try {
      const fila = espacar(50);
      const feitas: number[] = [];
      for (const n of [1, 2, 3]) void fila(async () => feitas.push(n));
      await vi.advanceTimersByTimeAsync(0);
      expect(feitas).toEqual([1]);
      await vi.advanceTimersByTimeAsync(49);
      expect(feitas).toEqual([1]);
      await vi.advanceTimersByTimeAsync(1);
      expect(feitas).toEqual([1, 2]);
      await vi.advanceTimersByTimeAsync(50);
      expect(feitas).toEqual([1, 2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });
});
