import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rumoDaCamera, paraReferenciaDoProjeto, direcaoDaSombra, pontoCardeal } from './bussola';
import { sunDirection, horaSaoPauloParaUtc } from './sun';
import { ORIGEM_PAULISTA } from '../geo/project';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('bússola', () => {
  it('pontos cardeais: norte = −z, leste = +x, sul = +z, oeste = −x', () => {
    expect(rumoDaCamera(v(0, -0.5, -1))).toBeCloseTo(0);
    expect(rumoDaCamera(v(1, 0, 0))).toBeCloseTo(90);
    expect(rumoDaCamera(v(0, 0, 1))).toBeCloseTo(180);
    expect(rumoDaCamera(v(-1, 0, 0))).toBeCloseTo(270);
  });

  it('rotação do projeto soma ao rumo e fica em [0, 360)', () => {
    expect(rumoDaCamera(v(0, 0, -1), 90)).toBeCloseTo(90);
    expect(rumoDaCamera(v(-1, 0, 0), 120)).toBeCloseTo(30);
    expect(rumoDaCamera(v(0, 0, -1), -30)).toBeCloseTo(330);
  });

  it('olhando para cima ou para baixo (sem direção horizontal) não vira NaN', () => {
    expect(Number.isFinite(rumoDaCamera(v(0, 1, 0)))).toBe(true);
  });

  it('nome do ponto cardeal', () => {
    expect(pontoCardeal(0)).toBe('N');
    expect(pontoCardeal(44)).toBe('NE');
    expect(pontoCardeal(181)).toBe('S');
    expect(pontoCardeal(359)).toBe('N');
  });

  it('referência do projeto: com o projeto girado 90°, o leste do mundo vira o "norte" do modelo', () => {
    const local = paraReferenciaDoProjeto(v(1, 0, 0), 90);
    expect(local.distanceTo(v(0, 0, -1))).toBeCloseTo(0, 6);
    expect(rumoDaCamera(local, 90)).toBeCloseTo(90);
  });
});

describe('sombra', () => {
  it('21/06 ao meio-dia em SP: sol ao norte → sombra aponta para o sul (+z)', () => {
    const sol = sunDirection(horaSaoPauloParaUtc('2026-06-21', 12), ORIGEM_PAULISTA.lat, ORIGEM_PAULISTA.lon);
    const s = direcaoDaSombra(sol)!;
    expect(s.z).toBeGreaterThan(0.95);
  });

  it('21/12 às 15h: sol a oeste → sombra para o leste (+x)', () => {
    const sol = sunDirection(horaSaoPauloParaUtc('2026-12-21', 15), ORIGEM_PAULISTA.lat, ORIGEM_PAULISTA.lon);
    expect(direcaoDaSombra(sol)!.x).toBeGreaterThan(0.8);
  });

  it('sol abaixo do horizonte ou a pino: sem sombra', () => {
    expect(direcaoDaSombra(v(1, -0.2, 0))).toBeNull();
    expect(direcaoDaSombra(v(0, 1, 0))).toBeNull();
  });
});
