import * as THREE from 'three';
import type { PecaFachada, TipoPecaFachada } from './fachada';

/**
 * Pano de vidro com caixilhos (uma face de unidade): faixa de peitoril embaixo, três folhas e bandeira em cima.
 * Tons de cinza: a cor da situação da unidade (material.color) tinge o vidro sem apagar os caixilhos.
 */
export function texturaDeJanelas(): THREE.CanvasTexture {
  const w = 512;
  const h = 192;
  const tela = document.createElement('canvas');
  tela.width = w;
  tela.height = h;
  const ctx = tela.getContext('2d')!;
  // vidro: reflexo do céu mais claro em cima
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f2f5f8');
  g.addColorStop(0.55, '#c9d2da');
  g.addColorStop(1, '#a9b4be');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2f343a'; // caixilho de alumínio
  const quadro = 8;
  ctx.fillRect(0, 0, w, quadro);
  ctx.fillRect(0, h - 26, w, 26); // peitoril
  ctx.fillRect(0, 0, quadro, h);
  ctx.fillRect(w - quadro, 0, quadro, h);
  for (let i = 1; i < 3; i++) ctx.fillRect((w * i) / 3 - 3, 0, 6, h);
  ctx.fillRect(0, h * 0.28, w, 5); // bandeira
  const t = new THREE.CanvasTexture(tela);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Materiais da fachada: concreto claro e vidro do guarda-corpo. */
export function materiaisDaFachada(): Record<'concreto' | 'vidro', THREE.MeshStandardMaterial> {
  return {
    concreto: new THREE.MeshStandardMaterial({ color: 0xe9e5dd, roughness: 0.82, metalness: 0 }),
    vidro: new THREE.MeshStandardMaterial({ color: 0xb7cfdc, roughness: 0.05, metalness: 0.25, transparent: true, opacity: 0.35, depthWrite: false }),
  };
}

const DE_VIDRO: ReadonlySet<TipoPecaFachada> = new Set(['guarda-corpo']);

/** Peças da fachada em poucas chamadas de desenho (uma malha instanciada por material). */
export function malhasDaFachada(pecas: readonly PecaFachada[], materiais: Record<'concreto' | 'vidro', THREE.Material>): THREE.InstancedMesh[] {
  const cubo = new THREE.BoxGeometry(1, 1, 1);
  const grupos = { concreto: pecas.filter((p) => !DE_VIDRO.has(p.tipo)), vidro: pecas.filter((p) => DE_VIDRO.has(p.tipo)) };
  const m = new THREE.Matrix4();
  const malhas: THREE.InstancedMesh[] = [];
  for (const [nome, lista] of Object.entries(grupos) as Array<['concreto' | 'vidro', PecaFachada[]]>) {
    if (!lista.length) continue;
    const malha = new THREE.InstancedMesh(cubo, materiais[nome], lista.length);
    malha.name = `fachada-${nome}`;
    lista.forEach((p, i) => {
      const c = p.caixa;
      m.makeScale(c.maxX - c.minX, c.maxY - c.minY, c.maxZ - c.minZ).setPosition((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
      malha.setMatrixAt(i, m);
    });
    malha.instanceMatrix.needsUpdate = true;
    malha.computeBoundingSphere();
    malha.castShadow = nome === 'concreto';
    // vidro não esconde a unidade atrás dele na máscara do giro (tocar no vidro da varanda abre a unidade)
    malha.userData.foraDaMascara = nome === 'vidro';
    malha.receiveShadow = true;
    malhas.push(malha);
  }
  return malhas;
}
