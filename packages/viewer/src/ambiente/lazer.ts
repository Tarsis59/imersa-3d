import * as THREE from 'three';
import type { Pose } from '../cameras/voo';
import { VENTO } from './vegetacao';

/** Ponto do lazer do empreendimento (piscina, academia...) nos eixos da cena. */
export interface PontoLazer {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Texto da placa (nome, com o ícone da categoria). */
  rotulo: string;
  /** Piscina ou espelho d'água: o som ambiente põe água ali. */
  agua?: boolean;
}

/** Altura da bolinha do marcador acima do piso, em metros. */
export const ALTURA_MARCADOR_M = 3.2;

/**
 * Câmera para mostrar um ponto do lazer: do lado de fora do prédio (o ponto fica entre a câmera e o prédio, que
 * aparece ao fundo), um pouco acima, a uma distância que mostra o espaço em volta.
 */
export function poseParaLazer(p: { x: number; y: number; z: number }, centroPredio: { x: number; z: number }, distancia = 16): Pose {
  let dx = p.x - centroPredio.x;
  let dz = p.z - centroPredio.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) {
    dx = 0.6; // ponto bem no meio (terraço): vista de diagonal
    dz = 0.8;
  } else {
    dx /= d;
    dz /= d;
  }
  const alvo = new THREE.Vector3(p.x, p.y + 1, p.z);
  const posicao = new THREE.Vector3(p.x + dx * distancia, p.y + distancia * 0.55, p.z + dz * distancia);
  return { posicao, alvo };
}

export interface MarcadoresLazer {
  objeto: THREE.Group;
  materiais: THREE.Material[];
  /** Id do ponto do objeto tocado (bolinha, haste ou placa), ou null. */
  idDe(o: THREE.Object3D | null): string | null;
  /** Ponto em destaque no tour (maior e com cor forte); `null` = nenhum. */
  destacar(id: string | null): void;
  /** Água da piscina (Plano 12a, item 12): reflexo do céu e ondulação; no aparelho fraco cai no material simples. */
  definirNivel(nivel: 'alto' | 'medio' | 'baixo'): void;
  /** Objetos para o raio do clique. */
  clicaveis(): THREE.Object3D[];
  destruir(): void;
}

const COR = 0x0ea5e9;
const COR_DESTAQUE = 0xf59e0b;
const RAIO_AGUA_M = 5.5;
type NivelAgua = 'alto' | 'medio' | 'baixo';
/** Ondulação (amplitude, em metros), rugosidade e intensidade do reflexo do céu por nível; no aparelho fraco, zero. */
export const AMPLITUDE_ONDA: Record<NivelAgua, number> = { alto: 0.05, medio: 0.035, baixo: 0 };
export const RUGOSIDADE_AGUA: Record<NivelAgua, number> = { alto: 0.05, medio: 0.1, baixo: 0.6 };
export const REFLEXO_AGUA: Record<NivelAgua, number> = { alto: 1.15, medio: 0.8, baixo: 0 };

/**
 * Ondulação animada no shader (Plano 12a, item 12): a superfície sobe e desce num padrão de ondas que anda
 * devagar (mesmo relógio do vento); cada piscina com sua fase, pela posição no mundo. Chamar depois de preparar
 * o material (encadeia o `onBeforeCompile` que já existe).
 */
function ondularAgua(m: THREE.Material, amplitude: { value: number }): void {
  const antes = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    antes.call(m, shader, r);
    shader.uniforms.uAguaTempo = VENTO.tempo;
    shader.uniforms.uAguaAmplitude = amplitude;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uAguaTempo;\nuniform float uAguaAmplitude;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 ondaMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;
        float onda = sin(ondaMundo.x * 0.6 + uAguaTempo * 1.6) + sin(ondaMundo.z * 0.5 - uAguaTempo * 1.3) * 0.7;
        transformed.y += onda * uAguaAmplitude;`,
      );
  };
  const chave = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${chave()}-agua`;
}

/**
 * Material da água da piscina (Plano 12a, item 12): reflete o céu (envMap/fresnel do próprio PBR, com o mapa de
 * ambiente do céu físico) e ondula no shader. `preparar` primeiro (CSM), a ondulação encadeia depois.
 */
export function materialDeAgua(preparar: (m: THREE.Material) => void, nivel: NivelAgua = 'alto'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x1f6f8c, roughness: RUGOSIDADE_AGUA[nivel], metalness: 0.05, envMapIntensity: REFLEXO_AGUA[nivel] });
  preparar(m);
  const amplitude = { value: AMPLITUDE_ONDA[nivel] };
  ondularAgua(m, amplitude);
  m.userData.amplitudeAgua = amplitude;
  return m;
}

/** Troca o nível da água sem recriar nem recompilar o material (só os números mudam). */
export function definirNivelAgua(m: THREE.MeshStandardMaterial, nivel: NivelAgua): void {
  m.roughness = RUGOSIDADE_AGUA[nivel];
  m.envMapIntensity = REFLEXO_AGUA[nivel];
  const amplitude = m.userData.amplitudeAgua as { value: number } | undefined;
  if (amplitude) amplitude.value = AMPLITUDE_ONDA[nivel];
}

/** Placa com o nome desenhada num canvas (sem fonte nem imagem para baixar). */
/** Placa de texto sempre de frente para a câmera (lazer, etiquetas das unidades). */
export function placa(texto: string): THREE.Sprite {
  const escala = 2;
  const tela = document.createElement('canvas');
  const ctx = tela.getContext('2d')!;
  const fonte = `600 ${28 * escala}px system-ui, sans-serif`;
  ctx.font = fonte;
  const largura = Math.ceil(ctx.measureText(texto).width) + 36 * escala;
  tela.width = largura;
  tela.height = 52 * escala;
  ctx.font = fonte;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  const r = 24 * escala;
  ctx.beginPath();
  ctx.roundRect(0, 0, tela.width, tela.height, r);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, 18 * escala, tela.height / 2 + escala);
  const textura = new THREE.CanvasTexture(tela);
  textura.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura, depthTest: false, transparent: true }));
  const alturaM = 1.1;
  sprite.scale.set((alturaM * tela.width) / tela.height, alturaM, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function criarMarcadoresLazer(pontos: readonly PontoLazer[], preparar: (m: THREE.Material) => void = () => undefined, nivelInicial: NivelAgua = 'alto'): MarcadoresLazer {
  const objeto = new THREE.Group();
  objeto.name = 'lazer';
  const haste = new THREE.CylinderGeometry(0.05, 0.05, ALTURA_MARCADOR_M, 8);
  haste.translate(0, ALTURA_MARCADOR_M / 2, 0);
  const bola = new THREE.SphereGeometry(0.45, 20, 14);
  const anel = new THREE.RingGeometry(0.7, 0.95, 32).rotateX(-Math.PI / 2);
  const geoAgua = new THREE.CircleGeometry(RAIO_AGUA_M, 24).rotateX(-Math.PI / 2);
  const porObjeto = new Map<THREE.Object3D, string>();
  const partes = new Map<string, { bola: THREE.Mesh; anel: THREE.Mesh; material: THREE.MeshBasicMaterial; placa: THREE.Sprite }>();
  const materiais: THREE.Material[] = [];
  const aguas: THREE.MeshStandardMaterial[] = [];
  for (const p of pontos) {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const material = new THREE.MeshBasicMaterial({ color: COR }); // a bolinha some atrás das paredes; a placa fica sempre à vista
    const mHaste = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
    const mAnel = new THREE.MeshBasicMaterial({ color: COR, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    materiais.push(material, mHaste, mAnel);
    const b = new THREE.Mesh(bola, material);
    b.position.y = ALTURA_MARCADOR_M;
    b.renderOrder = 9;
    const h = new THREE.Mesh(haste, mHaste);
    const a = new THREE.Mesh(anel, mAnel);
    a.position.y = 0.04;
    const s = placa(p.rotulo);
    s.position.y = ALTURA_MARCADOR_M + 1.1;
    materiais.push(s.material);
    g.add(h, a, b, s);
    if (p.agua) {
      // piscina ou espelho d'água: um disco com reflexo do céu e ondulação (Plano 12a, item 12)
      const matAgua = materialDeAgua(preparar, nivelInicial);
      materiais.push(matAgua);
      aguas.push(matAgua);
      const malhaAgua = new THREE.Mesh(geoAgua, matAgua);
      malhaAgua.position.y = 0.02;
      malhaAgua.receiveShadow = true;
      g.add(malhaAgua);
    }
    for (const o of [b, h, s]) porObjeto.set(o, p.id);
    partes.set(p.id, { bola: b, anel: a, material, placa: s });
    objeto.add(g);
  }
  return {
    objeto,
    materiais,
    idDe: (o) => (o ? (porObjeto.get(o) ?? null) : null),
    destacar(id) {
      for (const [k, p] of partes) {
        const ativo = k === id;
        p.material.color.setHex(ativo ? COR_DESTAQUE : COR);
        (p.anel.material as THREE.MeshBasicMaterial).color.setHex(ativo ? COR_DESTAQUE : COR);
        p.bola.scale.setScalar(ativo ? 1.5 : 1);
        p.anel.scale.setScalar(ativo ? 1.6 : 1);
      }
    },
    definirNivel(nivel) {
      for (const m of aguas) definirNivelAgua(m, nivel);
    },
    clicaveis: () => [...porObjeto.keys()],
    destruir() {
      haste.dispose();
      bola.dispose();
      anel.dispose();
      geoAgua.dispose();
      for (const m of materiais) {
        if (m instanceof THREE.SpriteMaterial) m.map?.dispose();
        m.dispose();
      }
    },
  };
}
