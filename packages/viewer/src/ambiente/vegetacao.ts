import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlanoPaisagismo } from './paisagismo';
import { ESCALA_PBR_M, prepararPbrMundo, type EstadoPbr } from './materiaisPbr';

export interface Paisagismo {
  objeto: THREE.Group;
  /** Materiais criados (para quem preparou esquecê-los ao refazer). */
  materiais: readonly THREE.Material[];
  /** Estado da textura PBR do chão (Plano 12a, item 5): liga/desliga por nível de qualidade (ver `viewer.ts`). */
  pbr: { gramado: EstadoPbr; calcada: EstadoPbr };
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
 * Espécies da região (Plano 12a, item 8): ipê (copa em flor, amarela ou rosa), palmeira (tronco fino e alto, folhas
 * em leque) e nativa genérica de copa larga (a árvore comum de calçada, como antes).
 */
export type Especie = 'nativa' | 'ipe-amarelo' | 'ipe-rosa' | 'palmeira';
const PESO_ESPECIE: ReadonlyArray<{ especie: Especie; peso: number }> = [
  { especie: 'nativa', peso: 55 },
  { especie: 'palmeira', peso: 20 },
  { especie: 'ipe-amarelo', peso: 15 },
  { especie: 'ipe-rosa', peso: 10 },
];
const PESO_TOTAL_ESPECIE = PESO_ESPECIE.reduce((s, p) => s + p.peso, 0);

/** Espécie pela posição (x, z): determinística (a mesma árvore é sempre a mesma espécie); hash próprio, diferente do tom/raio. */
export function escolherEspecie(x: number, z: number): Especie {
  const s = Math.sin(x * 23.14 + z * 7.91) * 91385.12;
  let r = (s - Math.floor(s)) * PESO_TOTAL_ESPECIE;
  for (const p of PESO_ESPECIE) {
    if ((r -= p.peso) < 0) return p.especie;
  }
  return 'nativa';
}

const COR_IPE_AMARELO = { escura: new THREE.Color(0xc98a00), clara: new THREE.Color(0xffd84d) };
const COR_IPE_ROSA = { escura: new THREE.Color(0xa83468), clara: new THREE.Color(0xf29bc6) };
const COR_PALMEIRA = new THREE.Color(0x3f7d3a);

export interface DescricaoArvore {
  x: number;
  y: number;
  z: number;
  altura: number;
  /** Raio da copa (ou das folhas, na palmeira). */
  raio: number;
  /** 0..1: variação do tom (verde da nativa, amarelo/rosa do ipê) e giro da copa. */
  tom: number;
  especie: Especie;
}

export interface ArvoresConstruidas {
  malhas: THREE.InstancedMesh[];
  materiais: THREE.Material[];
  destruir(): void;
}

/** Um "leque" de folhas de palmeira (7 folhas finas e caídas, giradas em volta do tronco), montado 1 vez. */
function construirFolhasDePalmeira(): THREE.BufferGeometry {
  const folhas = 7;
  const partes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < folhas; i++) {
    const folha = new THREE.BoxGeometry(0.1, 0.02, 1.15);
    folha.translate(0, 0, 0.575); // o cabo fica na origem (presa ao topo do tronco); a ponta sai para fora
    folha.rotateX(-0.55); // caída para baixo, como a folha real
    folha.rotateY((i / folhas) * Math.PI * 2);
    partes.push(folha);
  }
  const unida = mergeGeometries(partes, false)!;
  for (const f of partes) f.dispose();
  return unida;
}

/**
 * Monta as árvores por espécie em poucas chamadas de desenho (uma malha instanciada por parte): nativa e ipê
 * compartilham tronco + copa redonda (só a cor muda); palmeira tem geometria própria (tronco fino e alto, folhas em
 * leque). Reaproveitado pelo paisagismo do lote e pelas árvores de rua da cidade. `preparar` é quem já prepara o
 * material (CSM e o que mais o chamador precisar, como a sombra das nuvens).
 */
export function construirArvores(arvores: readonly DescricaoArvore[], preparar: (m: THREE.Material) => void, opcoes: { sombra?: boolean; detalheCopa?: number } = {}): ArvoresConstruidas {
  const sombra = opcoes.sombra ?? true;
  const detalheCopa = opcoes.detalheCopa ?? 2;
  const geos: THREE.BufferGeometry[] = [];
  const materiais: THREE.Material[] = [];
  const malhas: THREE.InstancedMesh[] = [];
  const material = (cor: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color: cor, ...extra });
    preparar(m);
    materiais.push(m);
    return m;
  };
  const redondas = arvores.filter((a) => a.especie !== 'palmeira');
  const palmeiras = arvores.filter((a) => a.especie === 'palmeira');
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eixo = new THREE.Vector3(0, 1, 0);
  const cor = new THREE.Color();

  if (redondas.length) {
    const tronco = new THREE.CylinderGeometry(0.14, 0.22, 1, 7);
    tronco.translate(0, 0.5, 0);
    const copa = new THREE.IcosahedronGeometry(1, detalheCopa);
    geos.push(tronco, copa);
    const troncos = new THREE.InstancedMesh(tronco, material(0x5b4636, { roughness: 0.95 }), redondas.length);
    const matCopa = material(0xffffff, { roughness: 0.9, flatShading: true });
    balancarComVento(matCopa);
    const copas = new THREE.InstancedMesh(copa, matCopa, redondas.length);
    redondas.forEach((a, i) => {
      const alturaTronco = a.altura * 0.42;
      m4.compose(new THREE.Vector3(a.x, a.y, a.z), q.identity(), new THREE.Vector3(1, alturaTronco, 1));
      troncos.setMatrixAt(i, m4);
      q.setFromAxisAngle(eixo, a.tom * Math.PI * 2);
      m4.compose(new THREE.Vector3(a.x, a.y + alturaTronco + a.raio * 0.8, a.z), q, new THREE.Vector3(a.raio, a.raio * 1.15, a.raio));
      copas.setMatrixAt(i, m4);
      const cores = a.especie === 'ipe-amarelo' ? COR_IPE_AMARELO : a.especie === 'ipe-rosa' ? COR_IPE_ROSA : { escura: VERDE_ESCURO, clara: VERDE_CLARO };
      copas.setColorAt(i, cor.copy(cores.escura).lerp(cores.clara, a.tom));
    });
    for (const malha of [troncos, copas]) {
      malha.castShadow = sombra;
      malha.receiveShadow = true;
      malha.instanceMatrix.needsUpdate = true;
      malha.computeBoundingSphere();
      malhas.push(malha);
    }
    if (copas.instanceColor) copas.instanceColor.needsUpdate = true;
  }

  if (palmeiras.length) {
    const tronco = new THREE.CylinderGeometry(0.1, 0.17, 1, 8);
    tronco.translate(0, 0.5, 0);
    const folhas = construirFolhasDePalmeira();
    geos.push(tronco, folhas);
    const troncos = new THREE.InstancedMesh(tronco, material(0x7a7054, { roughness: 0.88 }), palmeiras.length);
    const matFolhas = material(0xffffff, { roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
    balancarComVento(matFolhas);
    const copas = new THREE.InstancedMesh(folhas, matFolhas, palmeiras.length);
    palmeiras.forEach((a, i) => {
      const alturaTronco = a.altura * 0.85; // palmeira: o tronco é quase a árvore inteira
      m4.compose(new THREE.Vector3(a.x, a.y, a.z), q.identity(), new THREE.Vector3(1, alturaTronco, 1));
      troncos.setMatrixAt(i, m4);
      q.setFromAxisAngle(eixo, a.tom * Math.PI * 2);
      m4.compose(new THREE.Vector3(a.x, a.y + alturaTronco, a.z), q, new THREE.Vector3(a.raio, a.raio, a.raio));
      copas.setMatrixAt(i, m4);
      copas.setColorAt(i, cor.copy(COR_PALMEIRA).multiplyScalar(0.82 + a.tom * 0.3));
    });
    for (const malha of [troncos, copas]) {
      malha.castShadow = sombra;
      malha.receiveShadow = true;
      malha.instanceMatrix.needsUpdate = true;
      malha.computeBoundingSphere();
      malhas.push(malha);
    }
    if (copas.instanceColor) copas.instanceColor.needsUpdate = true;
  }

  return {
    malhas,
    materiais,
    destruir() {
      for (const g of geos) g.dispose();
    },
  };
}

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
  // textura PBR de mundo (Plano 12a, item 5): a malha é um plano do tamanho real do gramado/calçada, então a UV já
  // vem na escala certa; só repete pela escala em metros (sem precisar do truque de UV de mundo das peças da fachada)
  const plano2 = (r: PlanoPaisagismo['gramado'], y: number, cor: number, rugosidade: number, categoria: 'grama' | 'porcelanato'): EstadoPbr => {
    const largura = r.maxX - r.minX;
    const profundidade = r.maxZ - r.minZ;
    const g = new THREE.PlaneGeometry(largura, profundidade);
    geos.push(g);
    const mat = material(new THREE.MeshStandardMaterial({ color: cor, roughness: rugosidade }));
    const m = new THREE.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2);
    m.receiveShadow = true;
    objeto.add(m);
    return prepararPbrMundo(mat, ESCALA_PBR_M[categoria]);
  };
  const pbrCalcada = plano2(plano.calcada, 0.01, 0xc9c5bd, 0.9, 'porcelanato');
  const pbrGramado = plano2(plano.gramado, 0.02, 0x6a9442, 0.98, 'grama');

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  // espécies da região (Plano 12a, item 8): ipê, palmeira e nativa genérica, escolhidas pela posição da árvore
  const arvores = construirArvores(
    plano.arvores.map((a) => ({ x: a.x, y: 0, z: a.z, altura: a.altura, raio: a.raio, tom: a.tom, especie: a.especie })),
    preparar,
  );
  for (const malha of arvores.malhas) objeto.add(malha);
  mats.push(...arvores.materiais); // as geometrias das árvores são liberadas pelo próprio `arvores.destruir()`, abaixo

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
    pbr: { gramado: pbrGramado, calcada: pbrCalcada },
    definirNoite(luz) {
      if (lampadas) lampadas.emissiveIntensity = luz * 3;
    },
    destruir() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      arvores.destruir();
    },
  };
}
