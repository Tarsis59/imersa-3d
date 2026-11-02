import * as THREE from 'three';
import type { Caixa } from '../units/tipos';

export interface LimitesZoom {
  minimo: number;
  maximo: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Faixa de distância do zoom vertical (Plano 12b, item 3), proporcional ao tamanho do prédio. */
export function limitesZoom(caixa: Caixa): LimitesZoom {
  const raio = Math.max(5, new THREE.Vector3(caixa.maxX - caixa.minX, caixa.maxY - caixa.minY, caixa.maxZ - caixa.minZ).length() / 2);
  return { minimo: raio * 0.2, maximo: raio * 4 };
}

/** `t` ∈ [0, 1] (0 = bem afastado, 1 = bem perto) → distância da câmera ao alvo. */
export function distanciaDoZoom(t: number, limites: LimitesZoom): number {
  return limites.maximo - clamp01(t) * (limites.maximo - limites.minimo);
}

/** Inverso: a distância atual (roda do mouse, pinça) → o `t` ∈ [0, 1] para a telemetria e o slider. */
export function zoomDaDistancia(distancia: number, limites: LimitesZoom): number {
  return clamp01((limites.maximo - distancia) / Math.max(1e-6, limites.maximo - limites.minimo));
}
