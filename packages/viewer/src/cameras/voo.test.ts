import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { planejarVoo, enquadrar, enquadrarDeCima, suavizar } from './voo';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('voo animado', () => {
  const de = { posicao: v(0, 10, 100), alvo: v(0, 0, 0) };
  const para = { posicao: v(100, 10, 0), alvo: v(50, 5, 0) };
  const voo = planejarVoo(de, para);

  it('começa em "de" e termina em "para"', () => {
    expect(voo(0).posicao.distanceTo(de.posicao)).toBeCloseTo(0, 6);
    expect(voo(1).posicao.distanceTo(para.posicao)).toBeCloseTo(0, 6);
    expect(voo(1).alvo.distanceTo(para.alvo)).toBeCloseTo(0, 6);
  });

  it('t fora de [0, 1] é limitado', () => {
    expect(voo(-1).posicao.distanceTo(de.posicao)).toBeCloseTo(0, 6);
    expect(voo(2).posicao.distanceTo(para.posicao)).toBeCloseTo(0, 6);
  });

  it('suavização: lenta nas pontas, simétrica no meio', () => {
    expect(suavizar(0.5)).toBeCloseTo(0.5);
    expect(suavizar(0.1)).toBeLessThan(0.1);
    expect(suavizar(0.9)).toBeGreaterThan(0.9);
    expect(suavizar(0.25) + suavizar(0.75)).toBeCloseTo(1);
  });

  it('sobe em arco no meio (não atravessa prédios)', () => {
    const meio = voo(0.5).posicao;
    expect(meio.y).toBeGreaterThan(10 + 10);
    expect(voo(0.5).alvo.distanceTo(v(25, 2.5, 0))).toBeCloseTo(0, 6);
  });
});

describe('enquadrar', () => {
  it('a caixa inteira cabe no campo de visão, olhando para o centro, de cima', () => {
    const caixa = { minX: 10, maxX: 18, minY: 30, maxY: 33, minZ: -4, maxZ: 4 };
    for (const aspecto of [16 / 9, 9 / 16]) {
      const pose = enquadrar(caixa, 50, aspecto);
      const cam = new THREE.PerspectiveCamera(50, aspecto, 0.1, 10_000);
      cam.position.copy(pose.posicao);
      cam.lookAt(pose.alvo);
      cam.updateMatrixWorld();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      for (const x of [caixa.minX, caixa.maxX]) for (const y of [caixa.minY, caixa.maxY]) for (const z of [caixa.minZ, caixa.maxZ]) expect(frustum.containsPoint(v(x, y, z))).toBe(true);
      expect(pose.alvo.distanceTo(v(14, 31.5, 0))).toBeCloseTo(0, 6);
      expect(pose.posicao.y).toBeGreaterThan(pose.alvo.y);
    }
  });

  it('margem afasta a câmera na mesma direção (mostra as unidades vizinhas)', () => {
    const c = { minX: 0, maxX: 8, minY: 21, maxY: 24, minZ: 0, maxZ: 8 };
    const perto = enquadrar(c, 50, 1);
    const longe = enquadrar(c, 50, 1, 20, 2.3);
    expect(longe.posicao.distanceTo(longe.alvo) / perto.posicao.distanceTo(perto.alvo)).toBeCloseTo(2.3 / 1.15, 6);
  });

  it('chega de lado (20° acima do horizonte), para os andares de cima não esconderem a unidade', () => {
    const pose = enquadrar({ minX: 0, maxX: 8, minY: 21, maxY: 24, minZ: 0, maxZ: 8 }, 50, 1);
    const d = pose.posicao.clone().sub(pose.alvo);
    expect(THREE.MathUtils.radToDeg(Math.asin(d.y / d.length()))).toBeCloseTo(20, 5);
    const alto = enquadrar({ minX: 0, maxX: 8, minY: 0, maxY: 60, minZ: 0, maxZ: 8 }, 50, 1, 35);
    const d2 = alto.posicao.clone().sub(alto.alvo);
    expect(THREE.MathUtils.radToDeg(Math.asin(d2.y / d2.length()))).toBeCloseTo(35, 5);
  });
});

describe('enquadrarDeCima (planta 3D humanizada)', () => {
  const montarOrtografica = (caixa: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }, aspecto: number) => {
    const e = enquadrarDeCima(caixa, aspecto);
    const cam = new THREE.OrthographicCamera(-e.meiaAlturaMundo * aspecto, e.meiaAlturaMundo * aspecto, e.meiaAlturaMundo, -e.meiaAlturaMundo, 0.1, 2000);
    cam.position.copy(e.posicao);
    cam.up.set(0, 0, -1);
    cam.lookAt(e.alvo);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return { e, cam };
  };

  it('olha de cima para baixo, no centro do piso (minY) da caixa', () => {
    const caixa = { minX: 0, maxX: 10, minY: 20, maxY: 23, minZ: -5, maxZ: 5 };
    const { e } = montarOrtografica(caixa, 1);
    expect(e.alvo.distanceTo(v(5, 20, 0))).toBeCloseTo(0, 6);
    expect(e.posicao.x).toBeCloseTo(5);
    expect(e.posicao.z).toBeCloseTo(0);
    expect(e.posicao.y).toBeGreaterThan(caixa.maxY);
  });

  it('o pavimento inteiro cabe no volume de visão, em tela larga e em tela estreita', () => {
    const caixa = { minX: 0, maxX: 20, minY: 0, maxY: 3, minZ: 0, maxZ: 8 };
    for (const aspecto of [16 / 9, 9 / 16]) {
      const { e, cam } = montarOrtografica(caixa, aspecto);
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      for (const x of [caixa.minX, caixa.maxX]) for (const z of [caixa.minZ, caixa.maxZ]) expect(frustum.containsPoint(v(x, caixa.minY, z))).toBe(true);
      expect(e.meiaAlturaMundo).toBeGreaterThan(0);
    }
  });

  it('a meia-altura cobre o que for maior: a profundidade ou a largura ÷ aspecto da tela', () => {
    const caixa = { minX: 0, maxX: 20, minY: 0, maxY: 3, minZ: 0, maxZ: 4 };
    const largura = 20 * 1.1;
    const profundidade = 4 * 1.1;
    for (const aspecto of [4, 1, 0.1]) {
      expect(enquadrarDeCima(caixa, aspecto).meiaAlturaMundo).toBeCloseTo(Math.max(profundidade / 2, largura / (2 * aspecto)));
    }
    // tela bem larga (aspecto grande): a largura ÷ aspecto encolhe, então é a profundidade que manda
    expect(enquadrarDeCima(caixa, 100).meiaAlturaMundo).toBeCloseTo(profundidade / 2);
  });
});
