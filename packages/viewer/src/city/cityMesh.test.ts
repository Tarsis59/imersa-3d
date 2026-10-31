import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildingGeometry, buildCityMesh } from './cityMesh';
import type { Building } from './osm';

const quadrado: Building = {
  id: 1,
  height: 30,
  footprint: [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: -20 },
    { x: 0, z: -20 },
  ],
};

describe('buildingGeometry', () => {
  it('extruda do chão (y=0) até a altura, no lugar certo', () => {
    const g = buildingGeometry(quadrado);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.min.y).toBeCloseTo(0, 5);
    expect(bb.max.y).toBeCloseTo(30, 5);
    expect(bb.min.x).toBeCloseTo(0, 5);
    expect(bb.max.x).toBeCloseTo(10, 5);
    expect(bb.min.z).toBeCloseTo(-20, 5);
    expect(bb.max.z).toBeCloseTo(0, 5);
  });
});

describe('buildCityMesh', () => {
  it('junta todos os prédios em uma malha só', () => {
    const outro: Building = { ...quadrado, id: 2, height: 60, footprint: quadrado.footprint.map((p) => ({ x: p.x + 100, z: p.z })) };
    const mesh = buildCityMesh([quadrado, outro], new THREE.MeshStandardMaterial());
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(60, 5);
    expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(110, 5);
    expect(mesh.geometry.getAttribute('normal')).toBeDefined();
  });

  it('lista vazia não quebra', () => {
    const mesh = buildCityMesh([], new THREE.MeshStandardMaterial());
    expect(mesh.geometry.getAttribute('position')).toBeUndefined();
  });
});
