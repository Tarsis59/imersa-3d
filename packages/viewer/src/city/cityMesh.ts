import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Building } from './osm';

/**
 * Shape no plano XY com (x, -z) → extruda em +Z → rotateX(-90°) leva (x, y, h) para (x, h, -y) = (x, h, z).
 */
export function buildingGeometry(b: Building): THREE.BufferGeometry {
  const shape = new THREE.Shape(b.footprint.map((p) => new THREE.Vector2(p.x, -p.z)));
  // no relevo, o prédio desce um pouco abaixo do chão (terreno em declive não deixa vão embaixo)
  const enterrado = b.base ? 3 : 0;
  const g = new THREE.ExtrudeGeometry(shape, { depth: b.height + enterrado, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  if (b.base) g.translate(0, b.base - enterrado, 0);
  return g;
}

/** Uma malha única = 1 draw call para a cidade inteira. */
export function buildCityMesh(predios: Building[], material: THREE.Material): THREE.Mesh {
  if (predios.length === 0) return new THREE.Mesh(new THREE.BufferGeometry(), material);
  const partes = predios.map(buildingGeometry);
  const unida = mergeGeometries(partes, false);
  partes.forEach((g) => g.dispose());
  if (!unida) throw new Error('Falha ao unir geometrias da cidade');
  return new THREE.Mesh(unida, material);
}
