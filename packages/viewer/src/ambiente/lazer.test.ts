import { describe, expect, it } from 'vitest';
import { poseParaLazer } from './lazer';

describe('tour do lazer', () => {
  it('a câmera fica do lado de fora: o ponto entre ela e o prédio, olhando para o ponto', () => {
    const { posicao, alvo } = poseParaLazer({ x: 20, y: 0, z: 0 }, { x: 0, z: 0 });
    expect(alvo.toArray()).toEqual([20, 1, 0]);
    expect(posicao.x).toBeCloseTo(36); // mais longe do prédio que o ponto
    expect(posicao.z).toBeCloseTo(0);
    expect(posicao.y).toBeCloseTo(8.8); // um pouco acima, vendo o espaço em volta
  });

  it('terraço (ponto em cima do prédio, no meio): vista de diagonal, acima do terraço', () => {
    const { posicao, alvo } = poseParaLazer({ x: 0, y: 30, z: 0 }, { x: 0, z: 0 });
    expect(alvo.y).toBe(31);
    expect(posicao.y).toBeGreaterThan(30);
    expect(Math.hypot(posicao.x, posicao.z)).toBeGreaterThan(10);
  });
});
