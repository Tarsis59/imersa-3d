import * as THREE from 'three';
import type { PlanoPaisagismo } from './paisagismo';

export interface Paisagismo {
  objeto: THREE.Group;
  /** Materiais criados (para quem preparou esquecê-los ao refazer). */
  materiais: readonly THREE.Material[];
  /** 0 de dia → 1 à noite: lâmpadas dos postes acesas. */
  definirNoite(luz: number): void;
  destruir(): void;
}

/** Relógio do vento (segundos): o 3D avança a cada quadro; parado em "menos movimento" e na cena de teste. */
export const VENTO = { tempo: { value: 0 } };

/**
 * Copas balançando com o vento (Plano 12a, item 8): só o topo da copa se mexe, cada árvore no seu ritmo (pela
 * posição da instância). Chamar depois de preparar o material (encadeia o `onBeforeCompile` que já existe).
 */
export function balancarComVento(m: THREE.Material): void {
  const antes = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    antes.call(m, shader, r);
    shader.uniforms.uVento = VENTO.tempo;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uVento;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ventoFase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
      #else
        float ventoFase = 0.0;
      #endif
      float ventoPeso = clamp(transformed.y + 1.0, 0.0, 2.0) * 0.5;
      transformed.x += sin(uVento * 1.4 + ventoFase) * 0.05 * ventoPeso;
      transformed.z += cos(uVento * 1.1 + ventoFase * 1.3) * 0.04 * ventoPeso;`,
    );
  };
  const chave = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${chave()}-vento`;
}

const VERDE_ESCURO = new THREE.Color(0x3f6b2e);
const VERDE_CLARO = new THREE.Color(0x7aa547);

/**
 * Malhas do paisagismo: gramado, calçada, árvores (tronco + copa, tom variado) e postes com lâmpada que acende à
 * noite. Árvores e postes são instanciados (poucas chamadas de desenho mesmo com dezenas deles).
 */
export function criarPaisagismo(plano: PlanoPaisagismo, preparar: (m: THREE.Material) => void): Paisagismo {
  const objeto = new THREE.Group();
  objeto.name = 'paisagismo';
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const material = <T extends THREE.Material>(m: T) => {
    preparar(m);
    mats.push(m);
    return m;
  };
  const plano2 = (r: PlanoPaisagismo['gramado'], y: number, cor: number, rugosidade: number) => {
    const g = new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ);
    geos.push(g);
    const m = new THREE.Mesh(g, material(new THREE.MeshStandardMaterial({ color: cor, roughness: rugosidade })));
    m.rotation.x = -Math.PI / 2;
    m.position.set((r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
    m.receiveShadow = true;
    objeto.add(m);
  };
  plano2(plano.calcada, 0.01, 0xc9c5bd, 0.9);
  plano2(plano.gramado, 0.02, 0x6a9442, 0.98);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  if (plano.arvores.length) {
    const tronco = new THREE.CylinderGeometry(0.14, 0.22, 1, 7);
    tronco.translate(0, 0.5, 0);
    const copa = new THREE.IcosahedronGeometry(1, 2);
    geos.push(tronco, copa);
    const troncos = new THREE.InstancedMesh(tronco, material(new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.95 })), plano.arvores.length);
    const matCopa = material(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }));
    balancarComVento(matCopa);
    const copas = new THREE.InstancedMesh(copa, matCopa, plano.arvores.length);
    plano.arvores.forEach((a, i) => {
      const alturaTronco = a.altura * 0.42;
      m4.compose(new THREE.Vector3(a.x, 0, a.z), q.identity(), new THREE.Vector3(1, alturaTronco, 1));
      troncos.setMatrixAt(i, m4);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.tom * Math.PI * 2);
      m4.compose(new THREE.Vector3(a.x, alturaTronco + a.raio * 0.8, a.z), q, new THREE.Vector3(a.raio, a.raio * 1.15, a.raio));
      copas.setMatrixAt(i, m4);
      copas.setColorAt(i, VERDE_ESCURO.clone().lerp(VERDE_CLARO, a.tom));
    });
    for (const m of [troncos, copas]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      objeto.add(m);
    }
    if (copas.instanceColor) copas.instanceColor.needsUpdate = true;
  }

  let lampadas: THREE.MeshStandardMaterial | null = null;
  if (plano.postes.length) {
    const haste = new THREE.CylinderGeometry(0.06, 0.08, 5, 6);
    haste.translate(0, 2.5, 0);
    const cabeca = new THREE.BoxGeometry(0.5, 0.18, 0.32);
    geos.push(haste, cabeca);
    const hastes = new THREE.InstancedMesh(haste, material(new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.6, metalness: 0.5 })), plano.postes.length);
    lampadas = material(new THREE.MeshStandardMaterial({ color: 0xf3efe6, emissive: 0xffd39a, emissiveIntensity: 0 }));
    const cabecas = new THREE.InstancedMesh(cabeca, lampadas, plano.postes.length);
    plano.postes.forEach((p, i) => {
      hastes.setMatrixAt(i, m4.makeTranslation(p.x, 0, p.z));
      cabecas.setMatrixAt(i, m4.makeTranslation(p.x, 5.05, p.z));
    });
    for (const m of [hastes, cabecas]) {
      m.castShadow = true;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      objeto.add(m);
    }
  }

  return {
    objeto,
    materiais: mats,
    definirNoite(luz) {
      if (lampadas) lampadas.emissiveIntensity = luz * 3;
    },
    destruir() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
