import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ALTURA_MUDA_M, alturaDasCurvas, criarGramado, criarTerreno, type TerrenoLoteamentoLido } from './terrenoLoteamento';

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

/** Caixa de triângulos de uma geometria: min/max de cada eixo. */
function caixaDaGeometria(g: THREE.BufferGeometry): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const p = g.getAttribute('position');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.count; i++) {
    minX = Math.min(minX, p.getX(i));
    maxX = Math.max(maxX, p.getX(i));
    minY = Math.min(minY, p.getY(i));
    maxY = Math.max(maxY, p.getY(i));
    minZ = Math.min(minZ, p.getZ(i));
    maxZ = Math.max(maxZ, p.getZ(i));
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

describe('gramado do loteamento (bugfix das capturas de CI: lotes flutuando sobre o chão genérico cinza)', () => {
  const caixa = { minX: 0, maxX: 36, minZ: -130, maxZ: 0 };

  it('cobre a caixa recebida com margem (a rua/calçada do DXF de teste sai da caixa dos lotes)', () => {
    const g = criarGramado(caixa, () => 0, () => undefined);
    const b = caixaDaGeometria(g.objeto.geometry);
    // a margem cobre não só os lotes como a rua, que no DXF de teste fica ~8,5 m além da borda leste dos lotes
    expect(b.minX).toBeLessThanOrEqual(caixa.minX - 8.5);
    expect(b.maxX).toBeGreaterThanOrEqual(caixa.maxX + 8.5);
    expect(b.minZ).toBeLessThanOrEqual(caixa.minZ);
    expect(b.maxZ).toBeGreaterThanOrEqual(caixa.maxZ);
    g.destruir();
  });

  it('fica acima do chão genérico do viewer (y = 0) e abaixo da rua/calçada/meio-fio (0,05 a 0,22), nunca escondido por eles', () => {
    const g = criarGramado(caixa, () => 0, () => undefined);
    const b = caixaDaGeometria(g.objeto.geometry);
    expect(b.minY).toBeGreaterThan(0); // acima do chão genérico (y=0): senão ele cobre o gramado por cima
    expect(b.maxY).toBeLessThan(0.05); // abaixo da rua (a camada mais baixa da infraestrutura)
    g.destruir();
  });

  it('acompanha o relevo recebido (curvas de nível ou o relevo AWS), como a rua e os lotes', () => {
    const g = criarGramado(caixa, (x, z) => x + z, () => undefined);
    const b = caixaDaGeometria(g.objeto.geometry);
    // nos cantos opostos da caixa (com margem) a altura varia bastante: o gramado não é um tabuleiro plano à toa
    expect(b.maxY - b.minY).toBeGreaterThan(50);
    g.destruir();
  });

  it('o material passa pelo "preparar" de quem chama (CSM/sombra, como as outras camadas)', () => {
    const chamados: THREE.Material[] = [];
    const g = criarGramado(caixa, () => 0, (m) => chamados.push(m));
    expect(chamados).toHaveLength(1);
    expect(chamados[0]).toBe(g.objeto.material);
    g.destruir();
  });
});
