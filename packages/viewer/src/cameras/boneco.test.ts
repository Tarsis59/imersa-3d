import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { avancarFase, BONECOS, cameraAtrasDoOmbro, criarBoneco, poseDoBoneco, presetBoneco } from './boneco';

describe('animação do boneco', () => {
  it('andando: as pernas alternam e os braços vão ao contrário das pernas', () => {
    const p = poseDoBoneco(0.25, 2.2, false, 0, 0);
    expect(p.pernaE).toBeGreaterThan(0.3);
    expect(p.pernaD).toBeCloseTo(-p.pernaE, 9);
    expect(Math.sign(p.bracoE)).toBe(-Math.sign(p.pernaE));
    expect(poseDoBoneco(0.75, 2.2, false, 0, 0).pernaE).toBeLessThan(-0.3);
  });
  it('correndo balança mais e inclina o tronco', () => {
    const anda = poseDoBoneco(0.25, 2.2, false, 0, 0);
    const corre = poseDoBoneco(0.25, 4.5, false, 0, 0);
    expect(corre.pernaE).toBeGreaterThan(anda.pernaE);
    expect(corre.inclinacao).toBeGreaterThan(anda.inclinacao);
  });
  it('parado só respira (sem passo); no ar, pernas dobradas; acenando, o braço sobe', () => {
    const parado = poseDoBoneco(0.25, 0, false, 0, 1);
    expect(parado.pernaE).toBe(0);
    expect(Math.abs(parado.quique)).toBeLessThan(0.01);
    expect(poseDoBoneco(0.25, 0, true, 0, 0).joelhoE).toBeGreaterThan(0.8);
    expect(poseDoBoneco(0, 0, false, 1, 0).bracoDLado).toBeGreaterThan(2);
  });
  it('a fase do passo anda com a distância e dá a volta', () => {
    expect(avancarFase(0, 0.75)).toBeCloseTo(0.5, 9);
    expect(avancarFase(0.9, 0.3)).toBeCloseTo(0.1, 9);
  });
});

describe('boneco', () => {
  it('quatro bonecos para escolher; id desconhecido cai no primeiro', () => {
    expect(BONECOS.map((b) => b.id)).toEqual(['ana', 'beto', 'carla', 'davi']);
    expect(presetBoneco('xyz').id).toBe('ana');
  });
  it('fica de pé com ~1,75 m, nos pés indicados, e troca de roupa sem recriar', () => {
    const b = criarBoneco(presetBoneco('beto'), () => undefined);
    b.atualizar({ x: 3, y: 2, z: -1, yaw: 0 }, { distancia: 0, velocidade: 0, noAr: false, acenando: 0 }, 0, false);
    b.objeto.updateMatrixWorld(true);
    const caixa = new THREE.Box3().setFromObject(b.objeto);
    expect(caixa.min.y).toBeGreaterThan(1.9);
    expect(caixa.min.y).toBeLessThan(2.05);
    expect(caixa.max.y - caixa.min.y).toBeGreaterThan(1.65);
    expect(caixa.max.y - caixa.min.y).toBeLessThan(1.85);
    expect((caixa.min.x + caixa.max.x) / 2).toBeCloseTo(3, 0);
    b.trocar(presetBoneco('carla'));
    expect(b.preset.id).toBe('carla');
    b.destruir();
  });
});

describe('câmera atrás do ombro', () => {
  it('fica atrás (olhando para o norte, a câmera está ao sul), acima dos olhos e um pouco à direita', () => {
    const c = cameraAtrasDoOmbro({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, 3);
    expect(c.posicao.z).toBeCloseTo(3, 5);
    expect(c.posicao.y).toBeGreaterThan(1.6);
    expect(c.posicao.x).toBeGreaterThan(0.2);
    expect(c.alvo.z).toBeLessThan(0);
  });
  it('gira junto com a pessoa', () => {
    const c = cameraAtrasDoOmbro({ x: 0, y: 0, z: 0, yaw: Math.PI / 2, pitch: 0 }, 3);
    // olhando para o oeste (−x): a câmera fica a leste
    expect(c.posicao.x).toBeCloseTo(3, 5);
    expect(c.alvo.x).toBeLessThan(0);
  });
});
