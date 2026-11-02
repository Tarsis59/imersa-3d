import { describe, expect, it } from 'vitest';
import { criarQuadros, planejarQuadros } from './fotos';

const C = { lat: -23.56175, lon: -46.6545 };
const LOTE = { minX: -8, maxX: 8, minY: 0, maxY: 30, minZ: -8, maxZ: 8 };
/** Ponto a (x leste, z sul) metros do centro. */
const em = (x: number, z: number) => ({ lat: C.lat - z / 110_540, lon: C.lon + x / (111_320 * Math.cos((C.lat * Math.PI) / 180)) });
const frente = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

describe('quadros de foto no lugar', () => {
  it('na posição do GPS; a foto fica de frente para quem olha na direção da câmera', () => {
    // tirada 40 m ao sul do prédio, olhando para o norte (rumo 0)
    const [q] = planejarQuadros([{ id: 'a', ...em(0, 40), rumo: 0 }], C, 0, LOTE);
    expect(q!.x).toBeCloseTo(0, 1);
    expect(q!.z).toBeCloseTo(40, 1);
    // a frente da foto aponta para o sul (+z): quem está atrás do quadro, olhando para o norte, vê a foto
    expect(frente(q!.yaw).z).toBeCloseTo(1, 5);
    // rumo 90 (leste): a foto aponta para o oeste
    const [l] = planejarQuadros([{ id: 'b', ...em(0, 40), rumo: 90 }], C, 0, LOTE);
    expect(frente(l!.yaw).x).toBeCloseTo(-1, 5);
  });

  it('o giro do prédio vale para o lugar e para o rumo', () => {
    const [q] = planejarQuadros([{ id: 'a', ...em(0, 40), rumo: 0 }], C, 90, LOTE);
    // com 90°, o sul do chão fica no +x do modelo e o "olhar para o norte" (para o prédio) vira −x: a foto aponta +x
    expect(q!.x).toBeCloseTo(40, 1);
    expect(frente(q!.yaw).x).toBeCloseTo(1, 5);
  });

  it('sem bússola: de costas para o prédio (quem olha a foto olha o prédio)', () => {
    const [q] = planejarQuadros([{ id: 'a', ...em(30, 0), rumo: null }], C, 0, LOTE);
    expect(frente(q!.yaw).x).toBeCloseTo(1, 5);
  });

  it('dentro do lote vai para a calçada; longe demais fica de fora; no mesmo ponto se afastam', () => {
    const q = planejarQuadros(
      [
        { id: 'dentro', ...em(1, 6), rumo: null },
        { id: 'longe', ...em(900, 0), rumo: 0 },
        { id: 'a', ...em(0, 50), rumo: 0 },
        { id: 'b', ...em(0, 50), rumo: 0 },
      ],
      C,
      0,
      LOTE,
    );
    expect(q.map((x) => x.id)).toEqual(['dentro', 'a', 'b']);
    expect(q[0]!.z).toBeCloseTo(11, 5);
    expect(Math.hypot(q[1]!.x - q[2]!.x, q[1]!.z - q[2]!.z)).toBeGreaterThan(1.8);
  });

  it('cria um quadro por foto, clicável pela moldura ou pela foto', () => {
    const planos = planejarQuadros([{ id: 'a', ...em(0, 40), rumo: 0 }, { id: 'b', ...em(20, 40), rumo: 0 }], C, 0, LOTE);
    const q = criarQuadros(planos, () => 2, () => undefined);
    expect(q.quantos).toBe(2);
    expect(q.clicaveis()).toHaveLength(4);
    expect(q.idDe(q.clicaveis()[0]!)).toBe('a');
    expect(q.objeto.children[0]!.position.y).toBe(2); // no chão do relevo
    q.destruir();
  });
});
