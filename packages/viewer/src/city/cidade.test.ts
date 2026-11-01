import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { arvoresDeRua, criarCidade, doModelo, fita, paraModelo, poligono, terrenoDoRelevo, type RelevoEntorno } from './cidade';

const CENTRO = { lat: -23.56175, lon: -46.6545 };
const LOTE = { minX: -8, maxX: 8, minY: 0, maxY: 30, minZ: -8, maxZ: 8 };

/** Rampa: sobe 1 m a cada 10 m para o leste (relativo ao centro). */
function rampa(n = 41, raioM = 600): RelevoEntorno {
  const alturas: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) alturas.push((-raioM + (2 * raioM * i) / (n - 1)) / 10);
  return { centro: CENTRO, raioM, n, alturas };
}

describe('giro do modelo', () => {
  it('paraModelo e doModelo são inversas', () => {
    for (const g of [0, 37, -120, 270]) {
      const m = paraModelo(doModelo({ x: 12, z: -5 }, g), g);
      expect(m.x).toBeCloseTo(12, 9);
      expect(m.z).toBeCloseTo(-5, 9);
    }
  });
});

describe('terreno', () => {
  it('sem relevo: tudo plano', () => {
    const t = terrenoDoRelevo(null, CENTRO, 0, LOTE);
    expect(t.altura(100, 100)).toBe(0);
    expect(t.meioLado).toBe(0);
  });

  it('o lote fica plano; longe dele, o relevo de verdade; na borda desce ao horizonte', () => {
    const t = terrenoDoRelevo(rampa(), CENTRO, 0, LOTE);
    expect(t.altura(0, 0)).toBe(0);
    expect(t.altura(20, 0)).toBe(0); // dentro da faixa plana em volta do lote
    expect(t.altura(150, 0)).toBeCloseTo(15, 0); // leste sobe
    expect(t.altura(-150, 0)).toBeCloseTo(-15, 0); // oeste desce
    expect(t.horizonte).toBeLessThan(-40);
    expect(t.altura(t.meioLado, 0)).toBeCloseTo(t.horizonte, 5);
  });

  it('o giro do prédio gira o relevo junto (o leste do mapa continua alto)', () => {
    const t = terrenoDoRelevo(rampa(), CENTRO, 90, LOTE);
    // com 90°, o leste do chão fica no −z do modelo
    const leste = paraModelo({ x: 150, z: 0 }, 90);
    expect(t.altura(leste.x, leste.z)).toBeCloseTo(15, 0);
  });
});

const normalMedia = (g: THREE.BufferGeometry) => {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  const n = ng.attributes.normal as THREE.BufferAttribute;
  let y = 0;
  for (let i = 0; i < n.count; i++) y += n.getY(i);
  return y / n.count;
};

describe('geometrias', () => {
  it('fita da rua olha para cima e acompanha o relevo', () => {
    const g = fita({ pontos: [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 40 }], largura: 8 }, (x) => x / 10, 0.07)!;
    expect(normalMedia(g)).toBeGreaterThan(0.9);
    const p = g.attributes.position as THREE.BufferAttribute;
    // pontos a cada ~6 m (não só nos vértices do OSM)
    expect(p.count).toBeGreaterThan(30);
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(p.getX(i) / 10 + 0.07, 5);
  });

  it('polígono (parque) olha para cima nos dois sentidos de contorno, dividido para o relevo', () => {
    const quadrado = [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 50, z: 50 }, { x: 0, z: 50 }];
    for (const c of [quadrado, [...quadrado].reverse()]) {
      const g = poligono(c, () => 0, 0.03)!;
      expect(normalMedia(g)).toBeGreaterThan(0.99);
      expect((g.attributes.position as THREE.BufferAttribute).count).toBeGreaterThan(6 * 3);
    }
  });

  it('árvores de rua: nas calçadas, fora do lote e dos prédios, sempre as mesmas', () => {
    const vias = [{ tipo: 'local' as const, largura: 7, pontos: [{ x: -200, z: 30 }, { x: 200, z: 30 }] }];
    const predio = { minX: 50, maxX: 80, minY: 0, maxY: 20, minZ: 32, maxZ: 50 };
    const a = arvoresDeRua(vias, [predio], LOTE, () => 0, 400);
    expect(a.length).toBeGreaterThan(20);
    expect(a.every((t) => Math.abs(Math.abs(t.z - 30) - (3.5 + 1.2)) < 0.01)).toBe(true);
    expect(a.some((t) => t.x > 48.5 && t.x < 81.5 && t.z > 30)).toBe(false);
    expect(a.some((t) => Math.abs(t.x) < 20 && Math.abs(t.z) < 20)).toBe(false);
    expect(arvoresDeRua(vias, [predio], LOTE, () => 0, 400)).toEqual(a);
    // avenida e calçada de pedestre não ganham árvore
    expect(arvoresDeRua([{ ...vias[0]!, tipo: 'pedestre' }], [], null, () => 0, 400)).toEqual([]);
  });
});

describe('criarCidade', () => {
  const p = (x: number, z: number): [number, number] => [CENTRO.lon + x / (111_320 * Math.cos((CENTRO.lat * Math.PI) / 180)), CENTRO.lat - z / 110_540];
  const entrada = {
    centro: CENTRO,
    relevo: rampa(),
    vias: [
      { osmId: 'way/1', tipo: 'principal' as const, nome: 'Avenida', larguraM: 14, pontos: [p(-300, 40), p(300, 40)] },
      { osmId: 'way/2', tipo: 'pedestre' as const, nome: null, larguraM: 2.5, pontos: [p(-100, -60), p(100, -60)] },
      { osmId: 'way/3', tipo: 'local' as const, nome: 'Rua', larguraM: 7, pontos: [p(-150, -120), p(150, -120)] },
    ],
    areas: [{ osmId: 'way/9', tipo: 'verde' as const, contorno: [p(100, 100), p(180, 100), p(180, 180), p(100, 180)] }],
  };

  it('monta chão com relevo, ruas, verde e árvores; no aparelho fraco tira o que menos faz falta', () => {
    const c = criarCidade(entrada, 0, LOTE, [], () => undefined);
    expect(c.vias).toBe(3);
    expect(c.areas).toBe(1);
    expect(c.arvores).toBeGreaterThan(10);
    expect(c.pisos).toHaveLength(1);
    expect(c.pisos[0]!.name).toBe('terreno');
    const visiveis = () => c.objeto.children.filter((o) => o.visible).length;
    const todos = visiveis();
    c.definirNivel('baixo');
    expect(visiveis()).toBeLessThan(todos);
    c.definirNivel('alto');
    expect(visiveis()).toBe(todos);
    c.destruir();
  });

  it('rua que atravessa o lote é cortada nele (mesmo sem ponto do OSM dentro do lote)', () => {
    const c = criarCidade({ centro: CENTRO, vias: [{ osmId: 'way/5', tipo: 'local', nome: 'Rua', larguraM: 7, pontos: [p(-200, 0), p(200, 0)] }] }, 0, LOTE, [], () => undefined);
    const pos: THREE.Vector3[] = [];
    c.objeto.traverse((o) => {
      // as árvores são instâncias (a geometria-base fica na origem): só as faixas e o chão contam
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) {
        const a = o.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < a.count; i++) pos.push(new THREE.Vector3().fromBufferAttribute(a, i));
      }
    });
    expect(pos.length).toBeGreaterThan(0);
    expect(pos.some((q) => Math.abs(q.x) < 8 && Math.abs(q.z) < 3)).toBe(false);
    c.destruir();
  });

  it('sem relevo não cria chão (o plano do 3D continua) e a rua fica no y da calçada', () => {
    const c = criarCidade({ ...entrada, relevo: null }, 0, LOTE, [], () => undefined);
    expect(c.pisos).toHaveLength(0);
    expect(c.terreno.meioLado).toBe(0);
    const box = new THREE.Box3().setFromObject(c.objeto.children[0]!);
    expect(box.max.y).toBeLessThan(0.1);
    c.destruir();
  });
});
