import * as THREE from 'three';

/** Retângulo no chão (x, z). */
export interface Retangulo {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Caminho fechado no chão (a volta na calçada), medido em metros. */
export interface Caminho {
  pontos: Array<{ x: number; z: number }>;
  /** Distância acumulada até cada ponto (o último fecha a volta). */
  acumulado: number[];
  comprimento: number;
}

/** A volta pela calçada: o retângulo encolhido `recuo` metros (meio da calçada), no sentido anti-horário. */
export function caminhoRetangular(r: Retangulo, recuo: number): Caminho {
  const a = { minX: r.minX + recuo, maxX: r.maxX - recuo, minZ: r.minZ + recuo, maxZ: r.maxZ - recuo };
  const pontos = [
    { x: a.minX, z: a.maxZ },
    { x: a.maxX, z: a.maxZ },
    { x: a.maxX, z: a.minZ },
    { x: a.minX, z: a.minZ },
  ];
  const acumulado = [0];
  for (let i = 1; i <= pontos.length; i++) {
    const p = pontos[i - 1]!;
    const q = pontos[i % pontos.length]!;
    acumulado.push(acumulado[i - 1]! + Math.hypot(q.x - p.x, q.z - p.z));
  }
  return { pontos, acumulado, comprimento: acumulado[acumulado.length - 1]! };
}

/** Onde está quem andou `distancia` metros no caminho (dá voltas), e para onde olha (radianos; 0 = +z). */
export function posicaoNoCaminho(c: Caminho, distancia: number): { x: number; z: number; rumo: number } {
  if (c.comprimento <= 0) return { x: c.pontos[0]?.x ?? 0, z: c.pontos[0]?.z ?? 0, rumo: 0 };
  const d = ((distancia % c.comprimento) + c.comprimento) % c.comprimento;
  let i = 0;
  while (i < c.pontos.length - 1 && c.acumulado[i + 1]! <= d) i++;
  const p = c.pontos[i]!;
  const q = c.pontos[(i + 1) % c.pontos.length]!;
  const trecho = c.acumulado[i + 1]! - c.acumulado[i]!;
  const t = trecho > 0 ? (d - c.acumulado[i]!) / trecho : 0;
  return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, rumo: Math.atan2(q.x - p.x, q.z - p.z) };
}

export interface Morador {
  /** Onde começa na volta, em metros. */
  inicio: number;
  /** Metros por segundo (passeio: 0,9 a 1,4). */
  velocidade: number;
  /** 1 = no sentido do caminho; −1 = no contrário (cruza com os outros). */
  sentido: 1 | -1;
  /** Desvio para o lado (duas pessoas não andam na mesma linha). */
  lado: number;
  altura: number;
  roupa: number;
  calca: number;
  pele: number;
  /** Parada ocasional (Plano 12a, item 9): anda, para um pouco, anda de novo — ciclo próprio de cada pessoa. */
  parada: Parada;
}

/** Ciclo de "anda e para" de uma pessoa: a cada `cicloS` segundos, fica parada `duracaoS`, começando em `faseS`. */
export interface Parada {
  cicloS: number;
  duracaoS: number;
  faseS: number;
}

// paleta realista (tons do dia a dia, não cores de desenho animado): jeans, cinzas, bege, branco, grafite, vinho...
const ROUPAS = [0x3b5169, 0x8c6b52, 0x5b6b57, 0xc9c2b4, 0x2e2e32, 0x6b4a46, 0x7d8a99, 0xd8cdb8, 0x44403c, 0x9ba3ad];
const CALCAS = [0x2b3647, 0x3f3a36, 0x55524c, 0x1c1c1e, 0x6e6a63, 0x2f4156];
const PELES = [0xf2d3b3, 0xe0b48f, 0xc68d62, 0x9c6a43, 0x6b4428];

/** Gerador estável: os mesmos moradores para o mesmo prédio. */
function aleatorio(semente: number): () => number {
  let s = semente >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Moradores espalhados pela volta, com ritmo, sentido, altura, roupa e parada variados. */
export function planejarMoradores(quantos: number, comprimento: number, semente = 7): Morador[] {
  const rnd = aleatorio(semente);
  const escolher = <T>(l: readonly T[]) => l[Math.floor(rnd() * l.length)]!;
  return Array.from({ length: quantos }, (_, i) => ({
    inicio: ((i + rnd() * 0.6) / Math.max(1, quantos)) * comprimento,
    velocidade: 0.9 + rnd() * 0.5,
    sentido: rnd() < 0.5 ? 1 : -1,
    lado: (rnd() - 0.5) * 1.4,
    altura: 0.9 + rnd() * 0.2,
    roupa: escolher(ROUPAS),
    calca: escolher(CALCAS),
    pele: escolher(PELES),
    parada: { cicloS: 22 + rnd() * 18, duracaoS: 3 + rnd() * 5, faseS: rnd() * 40 },
  }));
}

/** Quantos moradores por nível de qualidade (no aparelho fraco, nenhum). */
export const MORADORES_POR_NIVEL: Record<'alto' | 'medio' | 'baixo', number> = { alto: 16, medio: 8, baixo: 0 };

const moduloPositivo = (a: number, m: number) => ((a % m) + m) % m;

/**
 * Tempo "andado" (segundos equivalentes) até `t`, com paradas periódicas: anda `cicloS − duracaoS` segundos, fica
 * parado `duracaoS`, e repete — sem saltos (continua de onde tinha parado). Pura: dá para testar sem o 3D.
 */
export function tempoAndado(t: number, parada: Parada): number {
  const { cicloS, duracaoS, faseS } = parada;
  if (!(duracaoS > 0) || duracaoS >= cicloS) return t; // parada mal configurada: anda sempre
  const andarS = cicloS - duracaoS;
  const T = t + faseS;
  const ciclosCompletos = Math.floor(T / cicloS);
  const andadoNoCiclo = Math.min(moduloPositivo(T, cicloS), andarS);
  return ciclosCompletos * andarS + andadoNoCiclo;
}

/** Se a pessoa está parada no instante `t` (olhando o relógio, parada no meio da volta). Pura, mesma regra de `tempoAndado`. */
export function estaParado(t: number, parada: Parada): boolean {
  const { cicloS, duracaoS, faseS } = parada;
  if (!(duracaoS > 0) || duracaoS >= cicloS) return false;
  return moduloPositivo(t + faseS, cicloS) >= cicloS - duracaoS;
}
/** Comprimento de um passo, em metros (o balanço das pernas acompanha a distância andada). */
const PASSO_M = 0.75;

export interface Pessoas {
  objeto: THREE.Group;
  /** Posição de todos no instante `t` (segundos). */
  quadro(t: number): void;
  /** Quantos aparecem (no máximo os planejados). */
  definirQuantidade(n: number): void;
  materiais: THREE.Material[];
  destruir(): void;
}

/**
 * Moradores em low-poly caminhando na calçada em volta do lote: corpo, cabeça, braços e pernas instanciados (uma
 * chamada de desenho por parte, para todos), com o balanço dos passos. Nada para baixar.
 */
export function criarPessoas(caminho: Caminho, moradores: readonly Morador[], preparar: (m: THREE.Material) => void): Pessoas {
  const objeto = new THREE.Group();
  objeto.name = 'pessoas';
  const n = moradores.length;
  const tronco = new THREE.CapsuleGeometry(0.2, 0.42, 4, 10);
  const cabeca = new THREE.SphereGeometry(0.12, 14, 10);
  // pernas e braços com o eixo no quadril e no ombro (giram a partir dali)
  const perna = new THREE.BoxGeometry(0.12, 0.82, 0.13).translate(0, -0.41, 0);
  const braco = new THREE.BoxGeometry(0.08, 0.6, 0.09).translate(0, -0.3, 0);
  const mRoupa = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const mCalca = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const mPele = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const materiais = [mRoupa, mCalca, mPele];
  for (const m of materiais) preparar(m);
  const malha = (g: THREE.BufferGeometry, m: THREE.Material, k: number) => {
    const x = new THREE.InstancedMesh(g, m, Math.max(1, n * k));
    x.castShadow = true;
    x.frustumCulled = false; // as instâncias andam pelo lote inteiro
    objeto.add(x);
    return x;
  };
  const corpos = malha(tronco, mRoupa, 1);
  const cabecas = malha(cabeca, mPele, 1);
  const pernas = malha(perna, mCalca, 2);
  const bracos = malha(braco, mRoupa, 2);
  const cor = new THREE.Color();
  moradores.forEach((m, i) => {
    corpos.setColorAt(i, cor.setHex(m.roupa));
    cabecas.setColorAt(i, cor.setHex(m.pele));
    for (const k of [0, 1]) {
      pernas.setColorAt(i * 2 + k, cor.setHex(m.calca));
      bracos.setColorAt(i * 2 + k, cor.setHex(m.roupa));
    }
  });
  let visiveis = n;
  const definirQuantidade = (q: number) => {
    visiveis = Math.max(0, Math.min(n, q));
    corpos.count = cabecas.count = visiveis;
    pernas.count = bracos.count = visiveis * 2;
    objeto.visible = visiveis > 0;
  };
  definirQuantidade(n);

  const base = new THREE.Matrix4();
  const parte = new THREE.Matrix4();
  const escala = new THREE.Matrix4();
  const giro = new THREE.Matrix4();
  const quadril = new THREE.Matrix4();
  const lado = new THREE.Vector3();
  return {
    objeto,
    materiais,
    definirQuantidade,
    quadro(t) {
      for (let i = 0; i < visiveis; i++) {
        const m = moradores[i]!;
        const parado = estaParado(t, m.parada);
        const andado = m.inicio + m.sentido * m.velocidade * tempoAndado(t, m.parada);
        const p = posicaoNoCaminho(caminho, andado);
        const rumo = p.rumo + (m.sentido < 0 ? Math.PI : 0);
        lado.set(Math.cos(rumo), 0, -Math.sin(rumo)).multiplyScalar(m.lado);
        const fase = (Math.abs(andado) / PASSO_M) * Math.PI;
        const balanco = parado ? 0 : Math.sin(fase);
        const sobe = parado ? 0 : Math.abs(Math.cos(fase)) * 0.03; // o corpo sobe um pouco a cada passo
        // balanço do quadril (Plano 12a, item 9): o tronco gira e desloca de leve a cada passo, o peso muda de pé
        base
          .makeRotationY(rumo)
          .setPosition(p.x + lado.x, 0, p.z + lado.z)
          .multiply(escala.makeScale(m.altura, m.altura, m.altura))
          .multiply(quadril.makeRotationY(balanco * 0.07).setPosition(Math.cos(fase) * 0.025, 0, 0));
        corpos.setMatrixAt(i, parte.copy(base).multiply(giro.makeTranslation(0, 1.16 + sobe, 0)));
        cabecas.setMatrixAt(i, parte.copy(base).multiply(giro.makeTranslation(0, 1.6 + sobe, 0)));
        for (const k of [0, 1]) {
          const s = k === 0 ? 1 : -1;
          pernas.setMatrixAt(i * 2 + k, parte.copy(base).multiply(giro.makeTranslation(s * 0.1, 0.84 + sobe, 0)).multiply(giro.makeRotationX(s * balanco * 0.5)));
          bracos.setMatrixAt(i * 2 + k, parte.copy(base).multiply(giro.makeTranslation(s * 0.245, 1.4 + sobe, 0)).multiply(giro.makeRotationX(-s * balanco * 0.45)));
        }
      }
      for (const x of [corpos, cabecas, pernas, bracos]) x.instanceMatrix.needsUpdate = true;
    },
    destruir() {
      for (const g of [tronco, cabeca, perna, braco]) g.dispose();
      for (const m of materiais) m.dispose();
      for (const x of [corpos, cabecas, pernas, bracos]) x.dispose();
    },
  };
}
