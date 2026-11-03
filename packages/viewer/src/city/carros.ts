import * as THREE from 'three';
import type { TipoVia, Xz } from './cidade';

/**
 * Carros nas ruas do entorno (Plano 12a, item 10): instâncias (poucos draw calls) andando pela malha de vias que
 * a cidade já carrega (`city/cidade.ts`), mão direita, faróis e lanternas acesos à noite. Nada no aparelho fraco.
 */

/** Trecho de rua pronto para andar: pontos nos eixos do modelo, com a distância acumulada. */
export interface PistaCarro {
  tipo: TipoVia;
  /** Largura do leito carroçável, em metros. */
  largura: number;
  pontos: Xz[];
  acumulado: number[];
  comprimento: number;
}

/** Metros por segundo por tipo de via (velocidade realista: ~22 a ~43 km/h; nada na calçada de pedestre). */
const VELOCIDADE_POR_TIPO: Record<TipoVia, number> = { principal: 12, secundaria: 9, local: 6, servico: 4, pedestre: 0 };
/** Trecho curto demais (menos de uma quadra): o carro ficaria indo e voltando toda hora. */
const COMPRIMENTO_MINIMO_M = 25;

/** Ruas por onde os carros andam: sem as de pedestre, e sem os trechos curtos demais. */
export function pistasDeVias(vias: ReadonlyArray<{ tipo: TipoVia; largura: number; pontos: Xz[] }>): PistaCarro[] {
  const saida: PistaCarro[] = [];
  for (const v of vias) {
    if (v.tipo === 'pedestre' || v.pontos.length < 2) continue;
    const acumulado = [0];
    for (let i = 1; i < v.pontos.length; i++) {
      const a = v.pontos[i - 1]!;
      const b = v.pontos[i]!;
      acumulado.push(acumulado[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
    }
    const comprimento = acumulado[acumulado.length - 1]!;
    if (comprimento < COMPRIMENTO_MINIMO_M) continue;
    saida.push({ tipo: v.tipo, largura: v.largura, pontos: v.pontos, acumulado, comprimento });
  }
  return saida;
}

export interface Carro {
  pista: number;
  /** Onde começa, em metros (0 a 2× o comprimento da pista: a 2ª metade já é o carro vindo de volta). */
  inicio: number;
  velocidade: number;
  cor: number;
}

const CORES_CARRO = [0xf5f5f5, 0x1a1a1a, 0xb6b6b6, 0x7a1f1f, 0x1f3f7a, 0x1f6b3f, 0xd4a017, 0x5a2d82, 0x8a8f99];

/** Gerador estável: os mesmos carros para a mesma cidade. */
function aleatorio(semente: number): () => number {
  let s = semente >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Quantos carros por nível de qualidade (no aparelho fraco, nenhum). */
export const CARROS_POR_NIVEL: Record<'alto' | 'medio' | 'baixo', number> = { alto: 10, medio: 5, baixo: 0 };

/** Carros espalhados pelas ruas (proporcional ao comprimento: a avenida longa tem mais que a rua curta), sempre os mesmos. */
export function planejarCarros(pistas: readonly PistaCarro[], quantos: number, semente = 11): Carro[] {
  if (!pistas.length || quantos <= 0) return [];
  const rnd = aleatorio(semente);
  const total = pistas.reduce((s, p) => s + p.comprimento, 0);
  return Array.from({ length: quantos }, () => {
    let alvo = rnd() * total;
    let pista = pistas.length - 1;
    for (let i = 0; i < pistas.length; i++) {
      if (alvo < pistas[i]!.comprimento) {
        pista = i;
        break;
      }
      alvo -= pistas[i]!.comprimento;
    }
    const p = pistas[pista]!;
    return {
      pista,
      inicio: rnd() * 2 * p.comprimento,
      velocidade: VELOCIDADE_POR_TIPO[p.tipo] * (0.85 + rnd() * 0.3),
      cor: CORES_CARRO[Math.floor(rnd() * CORES_CARRO.length)]!,
    };
  });
}

/**
 * Onde está o carro que andou `distancia` metros na pista (vai e volta: a rua não é um laço fechado como a
 * calçada dos moradores), para onde olha (`rumo`, 0 = +z) e já com o desvio da mão direita (cada sentido num
 * lado do eixo da pista, sem se cruzar).
 */
export function posicaoNaPista(p: PistaCarro, distancia: number): { x: number; z: number; rumo: number } {
  const c = p.comprimento;
  if (c <= 0 || p.pontos.length < 2) {
    const q = p.pontos[0] ?? { x: 0, z: 0 };
    return { x: q.x, z: q.z, rumo: 0 };
  }
  const ciclo = 2 * c;
  const m = ((distancia % ciclo) + ciclo) % ciclo;
  const indo = m <= c;
  const d = indo ? m : ciclo - m;
  let i = 0;
  while (i < p.pontos.length - 2 && p.acumulado[i + 1]! <= d) i++;
  const a = p.pontos[i]!;
  const b = p.pontos[i + 1]!;
  const trecho = p.acumulado[i + 1]! - p.acumulado[i]! || 1;
  const t = (d - p.acumulado[i]!) / trecho;
  const x = a.x + (b.x - a.x) * t;
  const z = a.z + (b.z - a.z) * t;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const sentido = indo ? 1 : -1;
  const rumo = Math.atan2(ux * sentido, uz * sentido);
  // mão direita: o perpendicular da pista, para o lado do sentido andado (quem vem não cruza com quem vai)
  const afasta = Math.max(1, p.largura / 4);
  return { x: x + uz * sentido * afasta, z: z - ux * sentido * afasta, rumo };
}

/** Brilho dos faróis e das lanternas: 0 de dia, acende com a luz noturna (0 a 1, igual às janelas e aos postes). */
export function intensidadeFarol(luzNoturna: number): number {
  return Math.max(0, luzNoturna) * 3;
}

export interface Carros {
  objeto: THREE.Group;
  materiais: THREE.Material[];
  /** Posição de todos os carros no instante `t` (segundos). */
  quadro(t: number): void;
  /** Quantos aparecem (no máximo os planejados). */
  definirQuantidade(n: number): void;
  /** Faróis e lanternas acesos (Plano 12a, item 10): `luzNoturna` 0 de dia a 1 de noite. */
  definirNoite(luzNoturna: number): void;
  /** Quantos estão visíveis agora. */
  contagem(): number;
  destruir(): void;
}

const COMPRIMENTO_M = 4.2;
const LARGURA_M = 1.75;
const ALTURA_M = 1.4;

/**
 * Carros em low-poly andando pelas pistas: carroceria, faróis (brancos) e lanternas (vermelhas) instanciados (uma
 * chamada de desenho por parte, para todos). Cores variadas pela instância.
 */
export function criarCarros(pistas: readonly PistaCarro[], carros: readonly Carro[], preparar: (m: THREE.Material) => void): Carros {
  const objeto = new THREE.Group();
  objeto.name = 'carros';
  const n = carros.length;
  const corpo = new THREE.BoxGeometry(LARGURA_M, ALTURA_M, COMPRIMENTO_M);
  const luzGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const mCorpo = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.35 });
  const mFarol = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2b0, emissiveIntensity: 0 });
  const mLanterna = new THREE.MeshStandardMaterial({ color: 0x4a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0 });
  const materiais = [mCorpo, mFarol, mLanterna];
  for (const m of materiais) preparar(m);
  const malha = (g: THREE.BufferGeometry, m: THREE.Material, k: number) => {
    const x = new THREE.InstancedMesh(g, m, Math.max(1, n * k));
    x.castShadow = true;
    x.frustumCulled = false; // os carros andam pela cidade inteira
    objeto.add(x);
    return x;
  };
  const corpos = malha(corpo, mCorpo, 1);
  const faroisMesh = malha(luzGeo, mFarol, 2);
  const lanternasMesh = malha(luzGeo, mLanterna, 2);
  const cor = new THREE.Color();
  carros.forEach((c, i) => corpos.setColorAt(i, cor.setHex(c.cor)));
  if (corpos.instanceColor) corpos.instanceColor.needsUpdate = true;

  let visiveis = n;
  const definirQuantidade = (q: number) => {
    visiveis = Math.max(0, Math.min(n, q));
    corpos.count = visiveis;
    faroisMesh.count = lanternasMesh.count = visiveis * 2;
    objeto.visible = visiveis > 0;
  };
  definirQuantidade(n);

  const base = new THREE.Matrix4();
  const parte = new THREE.Matrix4();
  const giro = new THREE.Matrix4();
  const frente = COMPRIMENTO_M / 2 - 0.15;
  return {
    objeto,
    materiais,
    contagem: () => visiveis,
    definirQuantidade,
    definirNoite(luzNoturna) {
      const i = intensidadeFarol(luzNoturna);
      mFarol.emissiveIntensity = i;
      mLanterna.emissiveIntensity = i;
    },
    quadro(t) {
      for (let i = 0; i < visiveis; i++) {
        const c = carros[i]!;
        const p = pistas[c.pista];
        if (!p) continue;
        const pos = posicaoNaPista(p, c.inicio + c.velocidade * t);
        base.makeRotationY(pos.rumo).setPosition(pos.x, ALTURA_M / 2, pos.z);
        corpos.setMatrixAt(i, base);
        for (const k of [0, 1]) {
          const lado = k === 0 ? -1 : 1;
          faroisMesh.setMatrixAt(i * 2 + k, parte.copy(base).multiply(giro.makeTranslation(lado * LARGURA_M * 0.32, -0.05, frente)));
          lanternasMesh.setMatrixAt(i * 2 + k, parte.copy(base).multiply(giro.makeTranslation(lado * LARGURA_M * 0.32, -0.05, -frente)));
        }
      }
      for (const x of [corpos, faroisMesh, lanternasMesh]) x.instanceMatrix.needsUpdate = true;
    },
    destruir() {
      corpo.dispose();
      luzGeo.dispose();
      for (const m of materiais) m.dispose();
      for (const x of [corpos, faroisMesh, lanternasMesh]) x.dispose();
    },
  };
}
