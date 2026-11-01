import * as THREE from 'three';

/**
 * Boneco do modo jogo (Plano 11d, item 15): a pessoa anda pela cidade e pelo prédio com um personagem, câmera atrás
 * do ombro. Desenhado aqui (licença própria, nada para baixar): corpo low-poly com quadril, joelhos e ombros que
 * giram, animado por código (andar, correr, pular, acenar e respirar parado). A frente do boneco é o −z (norte com
 * yaw 0, como a câmera da primeira pessoa).
 */

export interface PresetBoneco {
  id: string;
  nome: string;
  pele: number;
  roupa: number;
  calca: number;
  sapato: number;
  cabelo: number;
  /** Cabelo comprido (rabo de cavalo) ou curto; boné por cima, se tiver. */
  cabeloLongo: boolean;
  bone: number | null;
}

export const BONECOS: readonly PresetBoneco[] = [
  { id: 'ana', nome: 'Ana', pele: 0xc68a63, roupa: 0x2f7d8a, calca: 0x2b3442, sapato: 0xf2f2f2, cabelo: 0x2a1b14, cabeloLongo: true, bone: null },
  { id: 'beto', nome: 'Beto', pele: 0x8d5a3b, roupa: 0xe0a53a, calca: 0x3b4d6b, sapato: 0x222222, cabelo: 0x111111, cabeloLongo: false, bone: 0x1f5fa8 },
  { id: 'carla', nome: 'Carla', pele: 0xf0c9a6, roupa: 0xb8445a, calca: 0xe8e2d6, sapato: 0x7a4b2c, cabelo: 0x9b5a2a, cabeloLongo: true, bone: null },
  { id: 'davi', nome: 'Davi', pele: 0xe2b48c, roupa: 0x4c6b3c, calca: 0x2a2a2e, sapato: 0xd94f2b, cabelo: 0x5a3a22, cabeloLongo: false, bone: null },
];

export const presetBoneco = (id: string): PresetBoneco => BONECOS.find((b) => b.id === id) ?? BONECOS[0]!;

/** Metros andados por ciclo de passo (duas passadas). */
const PASSADA_M = 1.5;

export interface PoseAnimada {
  /** Quadril: giro das pernas (rad), positivo para a frente. */
  pernaE: number;
  pernaD: number;
  joelhoE: number;
  joelhoD: number;
  bracoE: number;
  bracoD: number;
  /** Braço direito para o lado (acenar). */
  bracoDLado: number;
  /** Sobe e desce do corpo (m). */
  quique: number;
  /** Inclinação do tronco para a frente (rad). */
  inclinacao: number;
}

/**
 * Pose do boneco a partir da fase do passo (0..1 por ciclo), da velocidade (m/s), de estar no ar e de acenar.
 * Pura: os testes conferem que as pernas alternam e que parado não balança.
 */
export function poseDoBoneco(fase: number, velocidade: number, noAr: boolean, acenando: number, t: number): PoseAnimada {
  const ang = fase * Math.PI * 2;
  const intensidade = Math.min(1, velocidade / 4.5);
  const andando = velocidade > 0.05;
  const balanco = andando ? 0.35 + 0.55 * intensidade : 0;
  const pernaE = Math.sin(ang) * balanco;
  const pernaD = -pernaE;
  // o joelho dobra quando a perna volta (atrás → frente)
  const joelho = (p: number, dp: number) => (andando ? Math.max(0, -dp) * (0.6 + 0.7 * intensidade) : 0) + (p < 0 ? -p * 0.2 : 0);
  let pose: PoseAnimada = {
    pernaE,
    pernaD,
    joelhoE: joelho(pernaE, Math.cos(ang)),
    joelhoD: joelho(pernaD, -Math.cos(ang)),
    bracoE: -pernaE * 0.9,
    bracoD: -pernaD * 0.9,
    bracoDLado: 0,
    quique: andando ? Math.abs(Math.sin(ang)) * 0.05 * (0.6 + intensidade) : Math.sin(t * 1.6) * 0.008,
    inclinacao: 0.12 * intensidade,
  };
  if (noAr) pose = { ...pose, pernaE: 0.6, pernaD: 0.15, joelhoE: 1.0, joelhoD: 0.5, bracoE: -0.9, bracoD: -0.9, quique: 0, inclinacao: 0.05 };
  if (acenando > 0) pose = { ...pose, bracoD: 0, bracoDLado: 2.5 + Math.sin(t * 9) * 0.35 * acenando };
  return pose;
}

/** Fase do passo depois de andar `distancia` metros. */
export const avancarFase = (fase: number, distancia: number): number => (fase + distancia / PASSADA_M) % 1;

export interface Boneco {
  objeto: THREE.Group;
  preset: PresetBoneco;
  /** Põe o boneco nos pés (x, y, z), virado para `yaw`, e anima. */
  atualizar(p: { x: number; y: number; z: number; yaw: number }, movimento: { distancia: number; velocidade: number; noAr: boolean; acenando: number }, t: number, semBalanco: boolean): void;
  trocar(preset: PresetBoneco): void;
  destruir(): void;
}

export function criarBoneco(preset: PresetBoneco, preparar: (m: THREE.Material) => void): Boneco {
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const mats = {
    pele: new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    roupa: new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    calca: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    sapato: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    cabelo: new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    bone: new THREE.MeshStandardMaterial({ roughness: 0.8 }),
  };
  for (const m of Object.values(mats)) preparar(m);
  const peca = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const malha = new THREE.Mesh(geo, m);
    malha.position.set(x, y, z);
    malha.castShadow = true;
    return malha;
  };

  const objeto = new THREE.Group();
  objeto.name = 'boneco';
  const corpo = new THREE.Group(); // sobe e desce (quique) e inclina
  objeto.add(corpo);
  // tronco e cabeça (alturas de uma pessoa de ~1,72 m)
  const tronco = peca(g(new THREE.CapsuleGeometry(0.19, 0.4, 4, 12)), mats.roupa, 0, 1.22, 0);
  tronco.scale.set(1, 1, 0.72);
  const pescoco = peca(g(new THREE.CylinderGeometry(0.055, 0.06, 0.08, 8)), mats.pele, 0, 1.53, 0);
  const cabeca = peca(g(new THREE.SphereGeometry(0.115, 16, 12)), mats.pele, 0, 1.64, 0);
  cabeca.scale.set(0.92, 1.05, 1);
  const nariz = peca(g(new THREE.ConeGeometry(0.018, 0.04, 6).rotateX(-Math.PI / 2)), mats.pele, 0, 1.635, -0.11);
  const cabelo = peca(g(new THREE.SphereGeometry(0.122, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), mats.cabelo, 0, 1.66, 0.008);
  const rabo = peca(g(new THREE.CapsuleGeometry(0.045, 0.16, 3, 8)), mats.cabelo, 0, 1.55, 0.12);
  rabo.rotation.x = 0.35;
  const bone = new THREE.Group();
  bone.add(peca(g(new THREE.SphereGeometry(0.126, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), mats.bone, 0, 1.67, 0));
  const aba = peca(g(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 16, 1, false, Math.PI * 0.5, Math.PI)), mats.bone, 0, 1.675, -0.08);
  bone.add(aba);
  corpo.add(tronco, pescoco, cabeca, nariz, cabelo, rabo, bone);

  // pernas: quadril → coxa → joelho → canela + pé
  const perna = (lado: number) => {
    const quadril = new THREE.Group();
    quadril.position.set(lado * 0.1, 0.92, 0);
    const coxa = peca(g(new THREE.CapsuleGeometry(0.075, 0.3, 3, 8)), mats.calca, 0, -0.22, 0);
    const joelho = new THREE.Group();
    joelho.position.y = -0.44;
    const canela = peca(g(new THREE.CapsuleGeometry(0.062, 0.3, 3, 8)), mats.calca, 0, -0.2, 0);
    const pe = peca(g(new THREE.BoxGeometry(0.1, 0.07, 0.24)), mats.sapato, 0, -0.43, -0.045);
    joelho.add(canela, pe);
    quadril.add(coxa, joelho);
    corpo.add(quadril);
    return { quadril, joelho };
  };
  const braco = (lado: number) => {
    const ombro = new THREE.Group();
    ombro.position.set(lado * 0.245, 1.42, 0);
    const parte = peca(g(new THREE.CapsuleGeometry(0.052, 0.48, 3, 8)), mats.roupa, 0, -0.29, 0);
    const mao = peca(g(new THREE.SphereGeometry(0.05, 10, 8)), mats.pele, 0, -0.58, 0);
    ombro.add(parte, mao);
    corpo.add(ombro);
    return ombro;
  };
  const pE = perna(-1);
  const pD = perna(1);
  const bE = braco(-1);
  const bD = braco(1);

  let atual = preset;
  const aplicar = (p: PresetBoneco) => {
    atual = p;
    mats.pele.color.setHex(p.pele);
    mats.roupa.color.setHex(p.roupa);
    mats.calca.color.setHex(p.calca);
    mats.sapato.color.setHex(p.sapato);
    mats.cabelo.color.setHex(p.cabelo);
    mats.bone.color.setHex(p.bone ?? 0);
    rabo.visible = p.cabeloLongo;
    bone.visible = p.bone !== null;
    cabelo.visible = p.bone === null;
  };
  aplicar(preset);
  let fase = 0;

  return {
    objeto,
    get preset() {
      return atual;
    },
    atualizar(p, mov, t, semBalanco) {
      objeto.position.set(p.x, p.y, p.z);
      objeto.rotation.y = p.yaw;
      fase = avancarFase(fase, mov.distancia);
      const pose = poseDoBoneco(semBalanco ? 0 : fase, semBalanco ? 0 : mov.velocidade, mov.noAr, mov.acenando, t);
      // giro positivo em x leva o pé (−y) para a frente (−z); o joelho dobra para trás
      pE.quadril.rotation.x = pose.pernaE;
      pD.quadril.rotation.x = pose.pernaD;
      pE.joelho.rotation.x = -pose.joelhoE;
      pD.joelho.rotation.x = -pose.joelhoD;
      bE.rotation.x = pose.bracoE;
      bD.rotation.x = pose.bracoD;
      bD.rotation.z = pose.bracoDLado;
      corpo.position.y = pose.quique;
      corpo.rotation.x = -pose.inclinacao;
    },
    trocar: aplicar,
    destruir() {
      for (const x of geos) x.dispose();
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}

/**
 * Câmera da terceira pessoa: atrás e um pouco acima do ombro direito, olhando para onde o boneco olha (com o pitch
 * da pessoa). `limite` encurta a distância quando há parede entre a cabeça e a câmera.
 */
export function cameraAtrasDoOmbro(p: { x: number; y: number; z: number; yaw: number; pitch: number }, distancia: number): { posicao: THREE.Vector3; alvo: THREE.Vector3; cabeca: THREE.Vector3 } {
  const frente = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  const direita = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const cabeca = new THREE.Vector3(p.x, p.y + 1.6, p.z).addScaledVector(direita, 0.32);
  // olhar para cima abaixa a câmera (e vice-versa), como nos jogos
  const altura = 0.35 - Math.sin(p.pitch) * distancia * 0.6;
  const posicao = cabeca.clone().addScaledVector(frente, -distancia * Math.cos(p.pitch * 0.6)).add(new THREE.Vector3(0, altura, 0));
  const alvo = cabeca.clone().addScaledVector(frente, 6).add(new THREE.Vector3(0, Math.sin(p.pitch) * 6, 0));
  return { posicao, alvo, cabeca };
}
