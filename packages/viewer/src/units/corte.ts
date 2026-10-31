import * as THREE from 'three';
import type { Caixa } from './tipos';

/** Topo do andar escolhido (maior Y entre as unidades dele); `null` se o andar não tem unidade no 3D. */
export function alturaDoCorte(porAndar: ReadonlyArray<{ andar: number; caixa: Caixa }>, andar: number): number | null {
  let topo = -Infinity;
  for (const p of porAndar) if (p.andar === andar) topo = Math.max(topo, p.caixa.maxY);
  return Number.isFinite(topo) ? topo : null;
}

/** Plano de recorte do three.js: mantém o que está abaixo de `y` e esconde o que está acima. */
export function planoDeCorte(y: number): THREE.Plane {
  return new THREE.Plane(new THREE.Vector3(0, -1, 0), y);
}
