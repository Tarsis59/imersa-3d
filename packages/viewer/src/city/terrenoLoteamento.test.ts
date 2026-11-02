import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ALTURA_MUDA_M, alturaDasCurvas, criarTerreno, type TerrenoLoteamentoLido } from './terrenoLoteamento';

const centro = { lon: -46.65, lat: -23.56 };
const DLON = (m: number) => m / 111_320;
const DLAT = (m: number) => m / 110_540;

describe('relevo simples das curvas de nível (Plano 12d, item 8)', () => {
  it('sem curvas, devolve null (quem chama cai para o relevo AWS)', () => {
    expect(alturaDasCurvas([])).toBeNull();
  });

  it('perto de uma amostra, a altura fica perto da cota dela (relativa à primeira)', () => {
    const h = alturaDasCurvas([
      { pontos: [{ x: 0, z: 0 }], elevacaoM: 700 },
      { pontos: [{ x: 100, z: 0 }], elevacaoM: 710 },
    ])!;
    expect(h(0, 0)).toBeCloseTo(0, 3); // a 1ª amostra é a referência (relativo = 0)
    expect(h(100, 0)).toBeCloseTo(10, 3);
    // no meio das duas, a mistura das duas cotas (nem 0 nem 10)
    const meio = h(50, 0);
    expect(meio).toBeGreaterThan(0);
    expect(meio).toBeLessThan(10);
  });
});

describe('terreno e infraestrutura no 3D (Plano 12d, item 8 e 10)', () => {
  const terreno: TerrenoLoteamentoLido = {
    ruas: [[[centro.lon - DLON(50), centro.lat - DLAT(6)], [centro.lon + DLON(50), centro.lat - DLAT(6)]]],
    calcadas: [[[centro.lon - DLON(50), centro.lat - DLAT(3)], [centro.lon + DLON(50), centro.lat - DLAT(3)]]],
    meioFio: [[[centro.lon - DLON(50), centro.lat - DLAT(4)], [centro.lon + DLON(50), centro.lat - DLAT(4)]]],
    curvas: [],
  };

  it('monta uma malha para rua, calçada e meio-fio, e árvores a cada ~8 m na calçada', () => {
    const t = criarTerreno(terreno, centro, 0, () => 0, () => undefined);
    const nomes = t.objeto.children.map((c) => c.name);
    expect(nomes).toContain('ruas');
    expect(nomes).toContain('calcadas');
    expect(nomes).toContain('meio-fio');
    // 100 m de calçada / 8 m ≈ 12 árvores de tronco (+ as copas, 2ª malha)
    const malhasDeArvore = t.objeto.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh);
    expect(malhasDeArvore.length).toBeGreaterThan(0);
    t.destruir();
  });

  it('"Daqui a 10 anos" (item 10): idade 0 fica na altura de muda; idade 10 é a adulta', () => {
    const t = criarTerreno(terreno, centro, 0, () => 0, () => undefined);
    const alturaDoTronco = (): number => {
      const tronco = t.objeto.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
      const m = new THREE.Matrix4();
      tronco.getMatrixAt(0, m);
      const escala = new THREE.Vector3();
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), escala);
      return escala.y;
    };
    t.definirIdadeArvores(0);
    const escalaMuda = alturaDoTronco();
    t.definirIdadeArvores(10);
    const escalaAdulta = alturaDoTronco();
    expect(escalaAdulta).toBeGreaterThan(escalaMuda);
    expect(escalaMuda).toBeGreaterThan(0); // nunca some (altura mínima = muda, ~1,5 m)
    t.destruir();
  });

  it('sem nenhuma camada: não quebra, e a altura cai para a função recebida', () => {
    const vazio: TerrenoLoteamentoLido = { ruas: [], calcadas: [], meioFio: [], curvas: [] };
    const t = criarTerreno(vazio, centro, 0, (x, z) => x + z, () => undefined);
    expect(t.objeto.children).toHaveLength(0);
    expect(t.altura(3, 4)).toBe(7);
    expect(() => t.definirIdadeArvores(5)).not.toThrow();
    t.destruir();
  });

  it('exporta ALTURA_MUDA_M (~1,5 m, a altura de viveiro de qualquer espécie)', () => {
    expect(ALTURA_MUDA_M).toBe(1.5);
  });
});
