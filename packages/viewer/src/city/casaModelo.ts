import * as THREE from 'three';
import type { Xz } from './cidade';

/**
 * Casa-modelo no lote (Plano 12d, item 9): um volume simples (paredes + telhado de quatro águas, porta e janelas
 * de fachada como decalques, sem BIM) nas medidas do lote, respeitando os recuos — nenhum vídeo de loteamento tem
 * isso. Recuos configuráveis aqui (metros).
 */
export const RECUOS_CASA_MODELO = { frenteM: 5, lateralM: 1.5, fundoM: 3 };

export interface FootprintCasa {
  cx: number;
  cz: number;
  /** Graus, mesma convenção de `paraModelo`: gira o grupo para a frente da casa olhar para `frenteNormal`. */
  anguloGraus: number;
  largura: number;
  profundidade: number;
}

/**
 * Retângulo construtivo do lote: a frente é o lado voltado para `frenteNormal` (a mesma normal do "Ver daqui",
 * item 11); mede a extensão do polígono nos eixos da frente e lateral (não precisa ser um retângulo perfeito) e
 * tira os recuos. `null` quando os recuos não deixam nenhuma área (lote pequeno demais).
 */
export function footprintConstrutivo(pontos: readonly Xz[], centro: Xz, frenteNormal: Xz, recuos = RECUOS_CASA_MODELO): FootprintCasa | null {
  const len = Math.hypot(frenteNormal.x, frenteNormal.z);
  if (len < 1e-6 || pontos.length < 3) return null;
  const dx = -frenteNormal.x / len;
  const dz = -frenteNormal.z / len; // eixo da profundidade, da frente para o fundo (para dentro do lote)
  const vx = -dz;
  const vz = dx; // eixo lateral
  let minD = Infinity;
  let maxD = -Infinity;
  let minL = Infinity;
  let maxL = -Infinity;
  for (const p of pontos) {
    const rx = p.x - centro.x;
    const rz = p.z - centro.z;
    const d = rx * dx + rz * dz;
    const l = rx * vx + rz * vz;
    minD = Math.min(minD, d);
    maxD = Math.max(maxD, d);
    minL = Math.min(minL, l);
    maxL = Math.max(maxL, l);
  }
  const largura = maxL - minL - 2 * recuos.lateralM;
  const profundidade = maxD - minD - recuos.frenteM - recuos.fundoM;
  if (largura <= 1 || profundidade <= 1) return null;
  const centroD = (minD + recuos.frenteM + (maxD - recuos.fundoM)) / 2;
  const centroL = (minL + maxL) / 2;
  return {
    cx: centro.x + dx * centroD + vx * centroL,
    cz: centro.z + dz * centroD + vz * centroL,
    anguloGraus: (Math.atan2(frenteNormal.x, frenteNormal.z) * 180) / Math.PI,
    largura,
    profundidade,
  };
}

export interface CasaModelo {
  objeto: THREE.Group;
  destruir(): void;
}

const ALTURA_PAREDE_M = 2.8;
const ALTURA_TELHADO_M = 1.6;

/** Casa simples (volume + telhado + porta/janelas) nas medidas do footprint, virada para a frente do lote. */
export function construirCasaModelo(f: FootprintCasa, alturaDoChao: (x: number, z: number) => number, preparar: (m: THREE.Material) => void): CasaModelo {
  const objeto = new THREE.Group();
  objeto.name = 'casa-modelo';
  objeto.position.set(f.cx, alturaDoChao(f.cx, f.cz), f.cz);
  objeto.rotation.y = (f.anguloGraus * Math.PI) / 180;
  const materiais: THREE.Material[] = [];
  const mat = (cor: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.85, ...extra });
    preparar(m);
    materiais.push(m);
    return m;
  };
  const paredes = new THREE.Mesh(new THREE.BoxGeometry(f.largura, ALTURA_PAREDE_M, f.profundidade), mat(0xe8e2d5));
  paredes.position.y = ALTURA_PAREDE_M / 2;
  paredes.castShadow = true;
  paredes.receiveShadow = true;
  objeto.add(paredes);
  // telhado de 4 águas: um "cone" de 4 lados encaixa certo num retângulo (sem telha de verdade, é só o volume)
  const diagonal = Math.hypot(f.largura, f.profundidade) || 1;
  const telhado = new THREE.Mesh(new THREE.ConeGeometry(diagonal / 2, ALTURA_TELHADO_M, 4), mat(0x7a4a3a, { flatShading: true }));
  telhado.rotation.y = Math.PI / 4;
  telhado.scale.set(f.largura / diagonal, 1, f.profundidade / diagonal);
  telhado.position.y = ALTURA_PAREDE_M + ALTURA_TELHADO_M / 2;
  telhado.castShadow = true;
  objeto.add(telhado);
  // porta e janelas na fachada da frente (+z local, já virado para a frente do lote pelo giro do grupo)
  const porta = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.9, f.largura * 0.3), 2.0), mat(0x4a3728));
  porta.position.set(0, 1.0, f.profundidade / 2 + 0.01);
  objeto.add(porta);
  if (f.largura > 3) {
    const vaoJanela = Math.min(1.1, f.largura * 0.22);
    for (const lado of [1, -1]) {
      const janela = new THREE.Mesh(new THREE.PlaneGeometry(vaoJanela, vaoJanela), mat(0xaee1f2, { roughness: 0.2, metalness: 0.2 }));
      janela.position.set(lado * Math.min(f.largura / 2 - 0.8, f.largura * 0.32), 1.5, f.profundidade / 2 + 0.01);
      objeto.add(janela);
    }
  }
  return {
    objeto,
    destruir() {
      objeto.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of materiais) m.dispose();
    },
  };
}
