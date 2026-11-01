import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { caixaDoMovel, movelPadrao } from '../configurador/moveis';
import { layoutDaTipologia, malhaDoMovel, montarDecorado, PALETA, planejarDecorado } from './decorado';

/** A caixa de uma unidade da fachada procedural (8 m menos as folgas). */
const UNIDADE = { minX: -7.8, maxX: -0.2, minY: 3.15, maxY: 5.85, minZ: -7.8, maxZ: -0.2 };
const JANELAS = [
  { x: 0, z: -1 },
  { x: 0, z: 1 },
  { x: 1, z: 0 },
  { x: -1, z: 0 },
];

/** Cantos do móvel já girado e posto no lugar (planta baixa). */
function cantos(m: { chave: string; x: number; z: number; yaw: number }) {
  const c = caixaDoMovel(movelPadrao(m.chave)!);
  return [
    [c.min[0], c.min[2]],
    [c.max[0], c.min[2]],
    [c.min[0], c.max[2]],
    [c.max[0], c.max[2]],
  ].map(([x, z]) => ({ x: m.x + x! * Math.cos(m.yaw) + z! * Math.sin(m.yaw), z: m.z - x! * Math.sin(m.yaw) + z! * Math.cos(m.yaw) }));
}

describe('apartamento decorado', () => {
  it('um cômodo por quarto (até 3), sala e cozinha sempre; studio sem paredes', () => {
    expect(layoutDaTipologia(0, 7.3, 7.3).comodos).toEqual(['sala', 'cozinha', 'cama']);
    expect(layoutDaTipologia(0, 7.3, 7.3).paredes).toEqual([]);
    expect(layoutDaTipologia(1, 7.3, 7.3).comodos).toEqual(['sala', 'cozinha', 'quarto de casal']);
    expect(layoutDaTipologia(3, 7.3, 7.3).comodos).toEqual(['sala', 'cozinha', 'quarto de casal', 'quarto', 'quarto']);
    expect(layoutDaTipologia(5, 7.3, 7.3).comodos).toHaveLength(5);
    // parede dos quartos com uma porta por quarto + divisórias entre eles
    expect(layoutDaTipologia(2, 7.3, 7.3).paredes).toHaveLength(3 + 1);
  });

  it.each(JANELAS)('janela para (%o): tudo dentro da unidade, no piso, e a entrada livre', (janela) => {
    for (const q of [0, 1, 2, 3]) {
      const p = planejarDecorado(UNIDADE, q, janela);
      expect(p.moveis.length).toBeGreaterThan(8);
      for (const m of p.moveis) {
        expect(m.y).toBeCloseTo(UNIDADE.minY + 0.02, 5);
        for (const c of cantos(m)) {
          expect(c.x).toBeGreaterThan(UNIDADE.minX - 0.05);
          expect(c.x).toBeLessThan(UNIDADE.maxX + 0.05);
          expect(c.z).toBeGreaterThan(UNIDADE.minZ - 0.05);
          expect(c.z).toBeLessThan(UNIDADE.maxZ + 0.05);
        }
      }
      for (const w of p.paredes) {
        expect(w.minX).toBeGreaterThanOrEqual(UNIDADE.minX - 0.1);
        expect(w.maxZ).toBeLessThanOrEqual(UNIDADE.maxZ + 0.1);
        expect(w.maxY).toBeLessThan(UNIDADE.maxY);
      }
      const e = p.entrada;
      expect(e.x > UNIDADE.minX && e.x < UNIDADE.maxX && e.z > UNIDADE.minZ && e.z < UNIDADE.maxZ).toBe(true);
      expect(p.paredes.some((w) => e.x > w.minX - 0.3 && e.x < w.maxX + 0.3 && e.z > w.minZ - 0.3 && e.z < w.maxZ + 0.3)).toBe(false);
    }
  });

  it('o sofá olha para a TV (que fica junto da janela)', () => {
    for (const janela of JANELAS) {
      const p = planejarDecorado(UNIDADE, 2, janela);
      const sofa = p.moveis.find((m) => m.chave === 'sofa-3')!;
      const tv = p.moveis.find((m) => m.chave === 'rack-tv')!;
      const frente = { x: Math.sin(sofa.yaw), z: Math.cos(sofa.yaw) };
      const paraTv = { x: tv.x - sofa.x, z: tv.z - sofa.z };
      expect(frente.x * paraTv.x + frente.z * paraTv.z).toBeGreaterThan(0);
      // e a TV fica do lado da janela
      expect(tv.x * janela.x + tv.z * janela.z).toBeGreaterThan(sofa.x * janela.x + sofa.z * janela.z);
    }
  });

  it('o estilo troca o tecido e a madeira; o resto do móvel fica', () => {
    const cores = (estilo: 'moderno' | 'classico' | 'jovem') => {
      const g = malhaDoMovel(movelPadrao('sofa-3')!, estilo, (c) => new THREE.MeshStandardMaterial({ color: c }));
      return new Set(g.children.map((m) => `#${((m as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString()}`));
    };
    expect(cores('jovem')).toEqual(new Set([PALETA.jovem.tecido]));
    expect(cores('classico')).toEqual(new Set([PALETA.classico.tecido]));
  });

  it('monta piso, paredes e móveis; destruir libera tudo', () => {
    const d = montarDecorado(planejarDecorado(UNIDADE, 2, { x: 0, z: -1 }, 'classico'), () => undefined);
    expect(d.moveis).toBeGreaterThan(10);
    expect(d.paredes).toHaveLength(4);
    expect(d.comodos).toContain('quarto de casal');
    expect(() => d.destruir()).not.toThrow();
  });
});
