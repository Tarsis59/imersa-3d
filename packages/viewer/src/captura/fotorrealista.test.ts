import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ceuEquiretangular } from './fotorrealista';

describe('céu da foto fotorrealista', () => {
  it('zênite em cima, horizonte no meio, chão embaixo; sem buraco nem valor inválido', () => {
    const horizonte = new THREE.Color(0.8, 0.85, 0.9);
    const zenite = new THREE.Color(0.2, 0.4, 0.8);
    const d = ceuEquiretangular(8, 64, horizonte, zenite);
    expect(d).toHaveLength(8 * 64 * 4);
    const linha = (y: number) => [d[y * 8 * 4]!, d[y * 8 * 4 + 1]!, d[y * 8 * 4 + 2]!];
    const topo = linha(0);
    const meio = linha(31);
    const baixo = linha(63);
    expect(topo[2]! / topo[0]!).toBeGreaterThan(meio[2]! / meio[0]!); // mais azul lá em cima
    expect(meio[0]).toBeGreaterThan(0.7); // perto do horizonte, a cor da neblina do 3D
    expect(baixo[0]).toBeLessThan(meio[0]!); // chão neutro, mais escuro
    expect([...d].every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    expect(d[3]).toBe(1);
  });
});
