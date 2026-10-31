import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { planejarVoo, enquadrar, suavizar } from './voo';

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
});
