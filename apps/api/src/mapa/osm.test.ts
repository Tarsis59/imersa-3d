import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { categorizar, comPrediosDeArquivo, consultaOverpass, consultaPredios, espacar, filaOverpass, interpretarNominatim, interpretarOverpass, interpretarPredios, type ServicosMapa } from './osm';

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

describe('prédios do entorno (OSM)', () => {
  const CENTRO = { lat: -23.5617, lon: -46.6545 };

  it('consulta só prédios no raio, com a geometria junto', () => {
    const q = consultaPredios(-23.5617, -46.6545, 500);
    expect(q).toContain('way["building"](around:500,-23.5617,-46.6545)');
    expect(q).toContain('out geom');
    expect(q).toMatch(/\[timeout:\d+\]/);
  });

  it('formato "out geom": contorno sem repetir o ponto final, altura pela tag height', () => {
    const json = {
      elements: [
        {
          type: 'way',
          id: 10,
          tags: { building: 'yes', height: '45 m' },
          geometry: [
            { lat: -23.5617, lon: -46.6545 },
            { lat: -23.5617, lon: -46.6544 },
            { lat: -23.5616, lon: -46.6544 },
            { lat: -23.5617, lon: -46.6545 },
          ],
        },
      ],
    };
    expect(interpretarPredios(json, CENTRO)).toEqual([
      { osmId: 'way/10', alturaM: 45, contorno: [[-46.6545, -23.5617], [-46.6544, -23.5617], [-46.6544, -23.5616]] },
    ]);
  });

  it('formato nós + vias (arquivo baixado): altura por andares × 3 ou 9 m; ignora ruas e contornos inválidos', () => {
    const json = {
      elements: [
        { type: 'node', id: 1, lat: -23.5617, lon: -46.6545 },
        { type: 'node', id: 2, lat: -23.5617, lon: -46.6544 },
        { type: 'node', id: 3, lat: -23.5616, lon: -46.6544 },
        { type: 'way', id: 20, nodes: [1, 2, 3, 1], tags: { building: 'apartments', 'building:levels': '20' } },
        { type: 'way', id: 21, nodes: [1, 2, 3], tags: { building: 'yes' } },
        { type: 'way', id: 22, nodes: [1, 2, 3], tags: { highway: 'residential' } },
        { type: 'way', id: 23, nodes: [1, 2], tags: { building: 'yes' } },
        { type: 'way', id: 24, nodes: [1, 2, 99], tags: { building: 'yes' } },
      ],
    };
    const r = interpretarPredios(json, CENTRO);
    expect(r.map((p) => [p.osmId, p.alturaM])).toEqual([
      ['way/20', 60],
      ['way/21', 9],
    ]);
  });

  it('mais próximos primeiro, com limite; coordenadas com 7 casas', () => {
    const via = (id: number, dLat: number) => ({
      type: 'way',
      id,
      tags: { building: 'yes' },
      geometry: [0, 1, 2].map((i) => ({ lat: CENTRO.lat + dLat + i * 0.00001, lon: CENTRO.lon + i * 0.0000123456789 })),
    });
    const r = interpretarPredios({ elements: [via(1, 0.01), via(2, 0.0001), via(3, 0.001)] }, CENTRO, 2);
    expect(r.map((p) => p.osmId)).toEqual(['way/2', 'way/3']);
    expect(r[0]!.contorno[1]![0]).toBe(-46.6544877);
  });

  it('resposta estranha vira lista vazia', () => {
    expect(interpretarPredios(null, CENTRO)).toEqual([]);
    expect(interpretarPredios({ elements: 'x' }, CENTRO)).toEqual([]);
  });
});

describe('prédios de arquivo (dados reais da Av. Paulista, sem internet)', () => {
  it('lê os prédios reais em volta e respeita o raio', async () => {
    const arquivo = fileURLToPath(new URL('../../../../exemplos/cidade-real/sao-paulo-paulista-osm.json', import.meta.url));
    const base = {} as ServicosMapa;
    const mapa = comPrediosDeArquivo(base, arquivo);
    const predios = await mapa.buscarPredios(-23.56175, -46.6545, 300);
    expect(predios.length).toBeGreaterThan(100);
    expect(predios.some((p) => p.alturaM > 60)).toBe(true); // a Paulista tem torres altas
    const cos = Math.cos((-23.56175 * Math.PI) / 180);
    for (const p of predios) {
      const lat = p.contorno.reduce((a, c) => a + c[1], 0) / p.contorno.length;
      const lon = p.contorno.reduce((a, c) => a + c[0], 0) / p.contorno.length;
      expect(Math.hypot((lat + 23.56175) * 110_540, (lon + 46.6545) * 111_320 * cos)).toBeLessThanOrEqual(300);
    }
  });
});

describe('filaOverpass (o mapa público cheio não derruba a criação)', () => {
  const resposta = (status: number, corpo: unknown = {}) => new Response(JSON.stringify(corpo), { status });

  it('tenta de novo quando o Overpass recusa (429) ou cai (504) e devolve o que veio', async () => {
    const status = [429, 504, 200];
    const fila = filaOverpass(async () => resposta(status.shift()!, { elements: [1] }), [1, 1]);
    await expect(fila('q', 1000, (j) => (j as { elements: number[] }).elements.length)).resolves.toBe(1);
    expect(status).toEqual([]);
  });

  it('desiste depois das esperas, com o motivo; e consulta errada (400) não repete', async () => {
    let chamadas = 0;
    const cheia = filaOverpass(async () => (chamadas++, resposta(429)), [1, 1]);
    await expect(cheia('q', 1000, () => 0)).rejects.toThrow('Overpass respondeu 429');
    expect(chamadas).toBe(3);
    chamadas = 0;
    const errada = filaOverpass(async () => (chamadas++, resposta(400)), [1, 1]);
    await expect(errada('q', 1000, () => 0)).rejects.toThrow('Overpass respondeu 400');
    expect(chamadas).toBe(1);
  });

  it('estourou o tempo: não repete (a espera já foi longa)', async () => {
    let chamadas = 0;
    const lenta = filaOverpass(async () => {
      chamadas++;
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }, [1, 1]);
    await expect(lenta('q', 1000, () => 0)).rejects.toThrow('timeout');
    expect(chamadas).toBe(1);
  });

  it('com espelhos: cada tentativa vai para o próximo servidor, e o tempo estourado no principal tenta o espelho', async () => {
    const usados: number[] = [];
    const fila = filaOverpass(
      async (_q, _t, tentativa) => {
        usados.push(tentativa);
        if (tentativa === 0) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
        if (tentativa === 1) return resposta(429);
        return resposta(200, { elements: [1, 2] });
      },
      [1, 1],
      3,
    );
    await expect(fila('q', 1000, (j) => (j as { elements: number[] }).elements.length)).resolves.toBe(2);
    expect(usados).toEqual([0, 1, 2]);
  });

  it('com espelhos: o tempo estourado em todos desiste no último', async () => {
    let chamadas = 0;
    const lenta = filaOverpass(
      async () => {
        chamadas++;
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      },
      [1, 1],
      2,
    );
    await expect(lenta('q', 1000, () => 0)).rejects.toThrow('timeout');
    expect(chamadas).toBe(2);
  });

  it('uma consulta de cada vez, mesmo pedidas juntas (e a falha de uma não trava a próxima)', async () => {
    let abertas = 0;
    let maximo = 0;
    const fila = filaOverpass(async (q) => {
      abertas++;
      maximo = Math.max(maximo, abertas);
      await new Promise((ok) => setTimeout(ok, 5));
      abertas--;
      return resposta(q === 'ruim' ? 400 : 200, { q });
    }, []);
    const r = await Promise.allSettled(['a', 'ruim', 'b'].map((q) => fila(q, 1000, (j) => (j as { q: string }).q)));
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(maximo).toBe(1);
  });
});
