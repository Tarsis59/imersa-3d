import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { alturaDoCorte, planoDeCorte } from './corte';

const caixa = (minY: number, maxY: number) => ({ minX: 0, maxX: 1, minY, maxY, minZ: 0, maxZ: 1 });

describe('corte por andar', () => {
  const porAndar = [
    { andar: 1, caixa: caixa(0, 2.8) },
    { andar: 1, caixa: caixa(0.1, 2.9) },
    { andar: 2, caixa: caixa(3, 5.8) },
  ];

  it('altura do corte = topo do andar escolhido', () => {
    expect(alturaDoCorte(porAndar, 1)).toBeCloseTo(2.9);
    expect(alturaDoCorte(porAndar, 2)).toBeCloseTo(5.8);
  });

  it('andar sem unidade ligada não tem corte', () => {
    expect(alturaDoCorte(porAndar, 7)).toBeNull();
  });

  it('plano esconde o que está acima e mantém o que está abaixo', () => {
    const p = planoDeCorte(2.9);
    expect(p.distanceToPoint(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0); // visível
    expect(p.distanceToPoint(new THREE.Vector3(0, 4, 0))).toBeLessThan(0); // cortado
  });
});
