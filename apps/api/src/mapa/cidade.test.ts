import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { distanciasAPe, giroParaOlhar, interpretarMalha, paraLocal, recuoDaRua, ruaMaisPerto, type Via } from './malha';
import { blocoDe, decodificarPng, lerRelevo, localParaLatLon } from './relevo';

const PAULISTA = { lat: -23.56175, lon: -46.6545 };
const ARQUIVO = new URL('../../../../exemplos/cidade-real/sao-paulo-paulista-osm.json', import.meta.url);
const PASTA_RELEVO = new URL('../../../../exemplos/cidade-real/relevo/', import.meta.url);
const osm = JSON.parse(readFileSync(ARQUIVO, 'utf8')) as unknown;

/** PNG RGB 8 bits com um filtro diferente em cada linha (o decodificador precisa dos 5). */
function png(largura: number, linhas: number[][], filtros: number[]): Buffer {
  const cru: number[] = [];
  const anterior = new Array(largura * 3).fill(0);
  linhas.forEach((l, y) => {
    const f = filtros[y]!;
    cru.push(f);
    l.forEach((v, x) => {
      const a = x >= 3 ? l[x - 3]! : 0;
      const c = anterior[x]!;
      const ac = x >= 3 ? anterior[x - 3]! : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? c : f === 3 ? (a + c) >> 1 : (() => {
        const p = a + c - ac;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - c);
        const pc = Math.abs(p - ac);
        return pa <= pb && pa <= pc ? a : pb <= pc ? c : ac;
      })();
      cru.push((v - pred) & 0xff);
    });
    l.forEach((v, x) => (anterior[x] = v));
  });
  const pedaco = (tipo: string, dados: Buffer) => {
    const b = Buffer.alloc(12 + dados.length);
    b.writeUInt32BE(dados.length, 0);
    b.write(tipo, 4, 'latin1');
    dados.copy(b, 8);
    return b; // o CRC não é conferido pelo decodificador
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(linhas.length, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pedaco('IHDR', ihdr), pedaco('IDAT', deflateSync(Buffer.from(cru))), pedaco('IEND', Buffer.alloc(0))]);
}

describe('relevo', () => {
  it('decodifica PNG RGB com os 5 filtros', () => {
    const linhas = [
      [10, 20, 30, 200, 210, 220],
      [11, 22, 33, 199, 0, 255],
      [5, 6, 7, 8, 9, 10],
      [255, 254, 253, 1, 2, 3],
      [100, 150, 200, 50, 60, 70],
    ];
    const p = decodificarPng(png(2, linhas, [0, 1, 2, 3, 4]));
    expect(p).toMatchObject({ largura: 2, altura: 5, canais: 3 });
    expect([...p.dados]).toEqual(linhas.flat());
    expect(() => decodificarPng(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it('bloco e volta do ponto local', () => {
    const t = blocoDe(PAULISTA.lat, PAULISTA.lon, 14);
    expect([Math.floor(t.x), Math.floor(t.y)]).toEqual([6068, 9295]);
    const p = localParaLatLon(PAULISTA, 100, -200);
    const l = paraLocal([p.lon, p.lat], PAULISTA);
    expect(l.x).toBeCloseTo(100, 6);
    expect(l.z).toBeCloseTo(-200, 6);
  });

  it('Paulista de verdade (4 blocos da AWS): espigão a ~820 m, o terreno desce para os lados', async () => {
    const r = await lerRelevo(PAULISTA, 600, async (z, x, y) => new Uint8Array(await readFile(new URL(`${z}-${x}-${y}.png`, PASTA_RELEVO))), 33);
    expect(r.n).toBe(33);
    expect(r.alturas).toHaveLength(33 * 33);
    expect(r.altitudeM).toBeGreaterThan(780);
    expect(r.altitudeM).toBeLessThan(860);
    // o centro é a referência (a Paulista é o ponto alto: em volta quase tudo é mais baixo)
    expect(Math.abs(r.alturas[16 * 33 + 16]!)).toBeLessThan(3);
    expect(Math.min(...r.alturas)).toBeLessThan(-40);
    // o SRTM mede a superfície (topo dos prédios altos também): o 3D suaviza
    expect(Math.max(...r.alturas)).toBeLessThan(50);
  });
});

describe('ruas, verde e água do OSM', () => {
  const malha = interpretarMalha(osm, PAULISTA, 600);

  it('lê as ruas com tipo e largura e os parques como verde', () => {
    expect(malha.vias.length).toBeGreaterThan(200);
    const paulista = malha.vias.filter((v) => v.nome === 'Avenida Paulista');
    expect(paulista.length).toBeGreaterThan(0);
    expect(paulista.every((v) => v.tipo === 'principal' && v.larguraM >= 9)).toBe(true);
    expect(malha.vias.some((v) => v.tipo === 'pedestre')).toBe(true);
    expect(malha.areas.filter((a) => a.tipo === 'verde').length).toBeGreaterThan(3);
    // plataforma de ônibus e prédio não viram rua
    expect(malha.vias.every((v) => v.pontos.length >= 2)).toBe(true);
  });

  it('a rua de carro mais perto do MASP é a Paulista', () => {
    const r = ruaMaisPerto(malha.vias, { lat: -23.5614, lon: -46.6559 })!;
    expect(r.via.nome).toBe('Avenida Paulista');
    expect(r.distanciaM).toBeLessThan(60);
  });

  it('a pé pelas ruas é mais longe que em linha reta (e nunca menos)', () => {
    const destinos = [
      { lat: -23.5655, lon: -46.6525 },
      { lat: -23.558, lon: -46.659 },
    ];
    const d = distanciasAPe(malha.vias, PAULISTA, destinos);
    destinos.forEach((t, i) => {
      const reta = Math.hypot(paraLocal([t.lon, t.lat], PAULISTA).x, paraLocal([t.lon, t.lat], PAULISTA).z);
      expect(d[i]).not.toBeNull();
      expect(d[i]!).toBeGreaterThanOrEqual(reta * 0.98);
      expect(d[i]!).toBeLessThan(reta * 2.2);
    });
  });
});

describe('caminho a pé (grafo)', () => {
  // duas ruas em L: do centro para o leste 200 m, depois para o sul 200 m
  const c = { lat: 0, lon: 0 };
  const p = (x: number, z: number): [number, number] => {
    const q = localParaLatLon(c, x, z);
    return [q.lon, q.lat];
  };
  const vias: Via[] = [
    { osmId: 'way/1', tipo: 'local', nome: 'Rua A', larguraM: 7, pontos: [p(0, 0), p(200, 0)] },
    { osmId: 'way/2', tipo: 'local', nome: 'Rua B', larguraM: 7, pontos: [p(200, 0), p(200, 200)] },
  ];
  it('segue as ruas (400 m), não a diagonal (283 m); longe da malha = null', () => {
    const [d, longe] = distanciasAPe(vias, c, [localParaLatLon(c, 200, 200), localParaLatLon(c, 2000, 2000)]);
    expect(d).toBeCloseTo(400, -1);
    expect(longe).toBeNull();
  });
});

describe('assentar o prédio na rua', () => {
  /** A conta do 3D (packages/viewer/src/city/entorno.ts): do chão para os eixos do modelo girado. */
  const paraModelo = (p: { x: number; z: number }, graus: number) => {
    const t = (graus * Math.PI) / 180;
    return { x: p.x * Math.cos(t) + p.z * Math.sin(t), z: -p.x * Math.sin(t) + p.z * Math.cos(t) };
  };
  it('o giro põe a rua na frente da entrada (+z do modelo) para qualquer lado', () => {
    for (const alvo of [{ x: 0, z: 30 }, { x: 30, z: 0 }, { x: -20, z: -20 }, { x: 5, z: -40 }]) {
      const m = paraModelo(alvo, giroParaOlhar(alvo));
      expect(Math.abs(m.x)).toBeLessThan(0.2);
      expect(m.z).toBeGreaterThan(0);
    }
  });
  it('ponto do endereço no meio da rua: recua para trás da calçada', () => {
    const via: Via = { osmId: 'way/9', tipo: 'local', nome: 'Rua C', larguraM: 8, pontos: [] };
    const novo = recuoDaRua({ via, ponto: { x: 0, z: 0 }, distanciaM: 0, direcao: { x: 1, z: 0 } }, 8)!;
    expect(Math.hypot(novo.x, novo.z)).toBeCloseTo(4 + 4 + 8, 5);
    // já longe da rua: não mexe
    expect(recuoDaRua({ via, ponto: { x: 0, z: 30 }, distanciaM: 30, direcao: { x: 1, z: 0 } }, 8)).toBeNull();
    // perto, do lado norte: recua para o norte (o lado em que já estava)
    const r = recuoDaRua({ via, ponto: { x: 0, z: 5 }, distanciaM: 5, direcao: { x: 1, z: 0 } }, 8)!;
    expect(r.z).toBeLessThan(0);
  });
});
