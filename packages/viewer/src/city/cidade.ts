import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lonLatToLocal, type LonLat } from '../geo/project';
import type { Caixa } from '../units/tipos';

/**
 * Cidade completa em volta do prédio (Plano 11b, item 7): chão com o relevo de verdade, ruas com calçada, praças e
 * parques, água e árvores de rua. Tudo nos eixos do modelo (girado `rotacaoGraus`, como o entorno de prédios) e em
 * blocos de `BLOCO_M` para a câmera não desenhar o que está fora da tela. O lote do prédio fica plano (y = 0).
 */

export type TipoVia = 'principal' | 'secundaria' | 'local' | 'servico' | 'pedestre';
export interface ViaEntorno {
  osmId: string;
  tipo: TipoVia;
  nome: string | null;
  larguraM: number;
  /** [lon, lat] */
  pontos: Array<[number, number]>;
}
export interface AreaEntorno {
  osmId: string;
  tipo: 'verde' | 'agua';
  contorno: Array<[number, number]>;
}
export interface RelevoEntorno {
  centro: LonLat;
  raioM: number;
  n: number;
  /** Norte → sul, cada linha oeste → leste; metros relativos ao centro da grade. */
  alturas: number[];
}

export interface Xz {
  x: number;
  z: number;
}

/** Chão local (x leste, z sul) → eixos do modelo (a mesma conta de `entornoParaLocal`). */
export function paraModelo(p: Xz, rotacaoGraus: number): Xz {
  const t = (rotacaoGraus * Math.PI) / 180;
  return { x: p.x * Math.cos(t) + p.z * Math.sin(t), z: -p.x * Math.sin(t) + p.z * Math.cos(t) };
}
/** Eixos do modelo → chão local (inversa de `paraModelo`). */
export function doModelo(m: Xz, rotacaoGraus: number): Xz {
  const t = (rotacaoGraus * Math.PI) / 180;
  return { x: m.x * Math.cos(t) - m.z * Math.sin(t), z: m.x * Math.sin(t) + m.z * Math.cos(t) };
}

/** Em volta do lote o chão continua plano, e só depois sobe ou desce até o terreno de verdade. */
const PLANO_M = 18;
const TRANSICAO_M = 30;
/** Nas bordas da área com relevo o chão desce até o plano do horizonte (sem degrau visível). */
const BORDA_M = 70;
const BLOCO_M = 200;

const suave = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const distanciaAoLote = (p: Xz, l: Caixa | null) => (l ? Math.hypot(Math.max(l.minX - p.x, 0, p.x - l.maxX), Math.max(l.minZ - p.z, 0, p.z - l.maxZ)) : Math.hypot(p.x, p.z));

export interface Terreno {
  /** Altura do chão no ponto (x, z) do modelo. */
  altura(x: number, z: number): number;
  /** Metade do lado do quadrado com relevo (eixos do modelo). */
  meioLado: number;
  /** Altura do chão do horizonte (abaixo de todo o relevo). */
  horizonte: number;
}

/**
 * Função de altura do chão nos eixos do modelo. A grade do SRTM mede a superfície (o topo dos prédios altos aparece
 * como morrinho): suaviza com média 3 × 3 antes. Sem relevo, tudo plano em 0.
 */
export function terrenoDoRelevo(relevo: RelevoEntorno | null | undefined, centro: LonLat, rotacaoGraus: number, lote: Caixa | null): Terreno {
  if (!relevo || relevo.n < 3 || relevo.alturas.length !== relevo.n * relevo.n) return { altura: () => 0, meioLado: 0, horizonte: 0 };
  const n = relevo.n;
  const bruto = relevo.alturas;
  const g = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      let s = 0;
      let k = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const jj = j + dj;
          const ii = i + di;
          if (jj >= 0 && jj < n && ii >= 0 && ii < n) {
            s += bruto[jj * n + ii]!;
            k++;
          }
        }
      g[j * n + i] = s / k;
    }
  const passo = (2 * relevo.raioM) / (n - 1);
  const amostra = (x: number, z: number) => {
    const fi = Math.min(n - 1.0001, Math.max(0, (x + relevo.raioM) / passo));
    const fj = Math.min(n - 1.0001, Math.max(0, (z + relevo.raioM) / passo));
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    const a = g[j * n + i]!;
    const b = g[j * n + i + 1]!;
    const c = g[(j + 1) * n + i]!;
    const d = g[(j + 1) * n + i + 1]!;
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  // o prédio pode ter andado um pouco desde a leitura do relevo (recuo da rua): a grade tem o próprio centro
  const o = lonLatToLocal(centro, relevo.centro);
  const h0 = amostra(o.x, o.z);
  // o quadrado do modelo (girado) precisa caber dentro da grade
  const meioLado = Math.max(0, (relevo.raioM - Math.hypot(o.x, o.z)) / Math.SQRT2 - passo);
  let minimo = 0;
  for (const v of g) minimo = Math.min(minimo, v - h0);
  const horizonte = minimo - 0.5;
  const altura = (x: number, z: number) => {
    const l = doModelo({ x, z }, rotacaoGraus);
    const real = amostra(o.x + l.x, o.z + l.z) - h0;
    const noLote = suave(PLANO_M, PLANO_M + TRANSICAO_M, distanciaAoLote({ x, z }, lote));
    const borda = suave(meioLado - BORDA_M, meioLado, Math.max(Math.abs(x), Math.abs(z)));
    return real * noLote * (1 - borda) + horizonte * borda;
  };
  return { altura, meioLado, horizonte };
}

const LARGURA_CALCADA: Record<TipoVia, number> = { principal: 3, secundaria: 2.5, local: 2, servico: 0, pedestre: 0 };
const PASSO_FAIXA_M = 6;

interface Faixa {
  pontos: Xz[];
  largura: number;
}

/** Fita (dois lados) ao longo da linha, com junta média nos vértices (sem buraco nas curvas). */
export function fita(f: Faixa, altura: (x: number, z: number) => number, acima: number): THREE.BufferGeometry | null {
  // mais pontos nos trechos longos: a fita acompanha o relevo
  const p: Xz[] = [];
  for (let i = 0; i < f.pontos.length; i++) {
    const a = f.pontos[i]!;
    if (i > 0) {
      const b = f.pontos[i - 1]!;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      const k = Math.ceil(d / PASSO_FAIXA_M);
      for (let s = 1; s < k; s++) p.push({ x: b.x + ((a.x - b.x) * s) / k, z: b.z + ((a.z - b.z) * s) / k });
    }
    p.push(a);
  }
  if (p.length < 2) return null;
  const pos: number[] = [];
  const idx: number[] = [];
  const meia = f.largura / 2;
  for (let i = 0; i < p.length; i++) {
    const ant = p[Math.max(0, i - 1)]!;
    const prox = p[Math.min(p.length - 1, i + 1)]!;
    let dx = prox.x - ant.x;
    let dz = prox.z - ant.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const nx = -dz * meia;
    const nz = dx * meia;
    const c = p[i]!;
    pos.push(c.x + nx, altura(c.x + nx, c.z + nz) + acima, c.z + nz, c.x - nx, altura(c.x - nx, c.z - nz) + acima, c.z - nz);
    if (i > 0) {
      const b = (i - 1) * 2;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Polígono → triângulos, com os grandes divididos (até ~10 m de lado) para deitar no relevo. */
export function poligono(contorno: Xz[], altura: (x: number, z: number) => number, acima: number): THREE.BufferGeometry | null {
  if (contorno.length < 3) return null;
  const v2 = contorno.map((p) => new THREE.Vector2(p.x, p.z));
  if (THREE.ShapeUtils.isClockWise(v2)) v2.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(v2, []);
  const pos: number[] = [];
  const dividir = (a: Xz, b: Xz, c: Xz, nivel: number) => {
    const maior = Math.max(Math.hypot(a.x - b.x, a.z - b.z), Math.hypot(b.x - c.x, b.z - c.z), Math.hypot(c.x - a.x, c.z - a.z));
    if (maior > 10 && nivel < 5) {
      const ab = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const bc = { x: (b.x + c.x) / 2, z: (b.z + c.z) / 2 };
      const ca = { x: (c.x + a.x) / 2, z: (c.z + a.z) / 2 };
      dividir(a, ab, ca, nivel + 1);
      dividir(ab, b, bc, nivel + 1);
      dividir(ca, bc, c, nivel + 1);
      dividir(ab, bc, ca, nivel + 1);
      return;
    }
    // ordem para a face olhar para cima (+y) com z para o sul
    for (const q of [a, c, b]) pos.push(q.x, altura(q.x, q.z) + acima, q.z);
  };
  const em = (i: number | undefined) => ({ x: v2[i!]!.x, z: v2[i!]!.y });
  for (const t of tris) dividir(em(t[0]), em(t[1]), em(t[2]), 0);
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export interface ArvoreDeRua {
  x: number;
  y: number;
  z: number;
  altura: number;
  raio: number;
  tom: number;
}

const ruido = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const dentroDe = (p: Xz, c: Pick<Caixa, 'minX' | 'maxX' | 'minZ' | 'maxZ'>, folga: number) => p.x > c.minX - folga && p.x < c.maxX + folga && p.z > c.minZ - folga && p.z < c.maxZ + folga;
const ESPACO_ARVORE_M = 15;
const MAX_ARVORES = 600;

/** Árvores nas calçadas das ruas locais e secundárias, fora dos prédios e do lote (sempre as mesmas para a mesma rua). */
export function arvoresDeRua(vias: ReadonlyArray<{ tipo: TipoVia; largura: number; pontos: Xz[] }>, obstaculos: readonly Caixa[], lote: Caixa | null, altura: (x: number, z: number) => number, meioLado: number): ArvoreDeRua[] {
  const saida: ArvoreDeRua[] = [];
  for (const v of vias) {
    if (v.tipo !== 'local' && v.tipo !== 'secundaria') continue;
    const afasta = v.largura / 2 + LARGURA_CALCADA[v.tipo] * 0.6;
    let resto = ESPACO_ARVORE_M / 2;
    for (let i = 1; i < v.pontos.length && saida.length < MAX_ARVORES; i++) {
      const a = v.pontos[i - 1]!;
      const b = v.pontos[i]!;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d === 0) continue;
      const nx = -(b.z - a.z) / d;
      const nz = (b.x - a.x) / d;
      for (let t = resto; t < d; t += ESPACO_ARVORE_M) {
        const c = { x: a.x + ((b.x - a.x) * t) / d, z: a.z + ((b.z - a.z) * t) / d };
        for (const lado of [1, -1]) {
          const p = { x: c.x + nx * afasta * lado, z: c.z + nz * afasta * lado };
          const r = ruido(p.x, p.z);
          if (r < 0.18) continue; // falhas na fileira, como na rua de verdade
          if (Math.max(Math.abs(p.x), Math.abs(p.z)) > meioLado - 10) continue;
          if (lote && dentroDe(p, lote, 12)) continue;
          if (obstaculos.some((o) => dentroDe(p, o, 1.5))) continue;
          saida.push({ x: p.x, y: altura(p.x, p.z), z: p.z, altura: 5 + r * 4, raio: 1.6 + r * 1.2, tom: r });
        }
      }
      resto = ((resto - d) % ESPACO_ARVORE_M + ESPACO_ARVORE_M) % ESPACO_ARVORE_M;
    }
  }
  return saida.slice(0, MAX_ARVORES);
}

export interface CidadeCompleta {
  objeto: THREE.Group;
  /** Onde dá para pisar (o chão com relevo). */
  pisos: THREE.Object3D[];
  materiais: THREE.Material[];
  terreno: Terreno;
  vias: number;
  areas: number;
  arvores: number;
  /** No aparelho fraco: tira calçadas de pedestre e árvores de rua (o que menos faz falta). */
  definirNivel(nivel: 'alto' | 'medio' | 'baixo'): void;
  destruir(): void;
}

const VERDE_ESCURO = new THREE.Color(0x2f5a2a);
const VERDE_CLARO = new THREE.Color(0x6f9a3c);

export function criarCidade(
  entrada: { centro: LonLat; vias?: readonly ViaEntorno[]; areas?: readonly AreaEntorno[]; relevo?: RelevoEntorno | null },
  rotacaoGraus: number,
  lote: Caixa | null,
  obstaculos: readonly Caixa[],
  preparar: (m: THREE.Material) => void,
): CidadeCompleta {
  const terreno = terrenoDoRelevo(entrada.relevo, entrada.centro, rotacaoGraus, lote);
  const h = terreno.altura;
  const objeto = new THREE.Group();
  objeto.name = 'cidade-completa';
  const materiais: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const material = (cor: number, rugosidade: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color: cor, roughness: rugosidade, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...extra });
    preparar(m);
    materiais.push(m);
    return m;
  };
  const pisos: THREE.Object3D[] = [];

  // chão com relevo (só quando há relevo; senão o chão plano do 3D continua)
  if (terreno.meioLado > 0) {
    const seg = Math.min(160, Math.max(16, Math.round((2 * terreno.meioLado) / 8)));
    const g = new THREE.PlaneGeometry(2 * terreno.meioLado, 2 * terreno.meioLado, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, h(p.getX(i), p.getZ(i)) - 0.02);
    g.computeVertexNormals();
    geos.push(g);
    const chao = new THREE.Mesh(g, material(0xd2cec4, 1, { polygonOffset: false }));
    chao.name = 'terreno';
    chao.receiveShadow = true;
    objeto.add(chao);
    pisos.push(chao);
  }

  // ruas e calçadas (em blocos)
  const rot = rotacaoGraus;
  const local = (p: [number, number]) => paraModelo(lonLatToLocal({ lon: p[0], lat: p[1] }, entrada.centro), rot);
  const limite = terreno.meioLado > 0 ? terreno.meioLado : 800;
  const vias = (entrada.vias ?? []).map((v) => ({ tipo: v.tipo, largura: v.larguraM, pontos: v.pontos.map(local) }));
  const blocos = new Map<string, { asfalto: THREE.BufferGeometry[]; calcada: THREE.BufferGeometry[]; pedestre: THREE.BufferGeometry[]; verde: THREE.BufferGeometry[]; agua: THREE.BufferGeometry[] }>();
  const bloco = (p: Xz) => {
    const k = `${Math.floor(p.x / BLOCO_M)},${Math.floor(p.z / BLOCO_M)}`;
    let b = blocos.get(k);
    if (!b) blocos.set(k, (b = { asfalto: [], calcada: [], pedestre: [], verde: [], agua: [] }));
    return b;
  };
  let nVias = 0;
  for (const v of vias) {
    // trechos fora da área ou em cima do lote ficam de fora (calçada do condomínio é o paisagismo)
    const trechos: Xz[][] = [];
    let atual: Xz[] = [];
    // pontos a cada ~6 m antes de cortar: um trecho longo que atravessa o lote também é cortado
    const densos: Xz[] = [];
    v.pontos.forEach((q, i) => {
      if (i > 0) {
        const a = v.pontos[i - 1]!;
        const k = Math.ceil(Math.hypot(q.x - a.x, q.z - a.z) / PASSO_FAIXA_M);
        for (let s = 1; s < k; s++) densos.push({ x: a.x + ((q.x - a.x) * s) / k, z: a.z + ((q.z - a.z) * s) / k });
      }
      densos.push(q);
    });
    for (const p of densos) {
      const fora = Math.max(Math.abs(p.x), Math.abs(p.z)) > limite - 5 || (lote !== null && dentroDe(p, lote, 2));
      if (fora) {
        if (atual.length > 1) trechos.push(atual);
        atual = [];
      } else atual.push(p);
    }
    if (atual.length > 1) trechos.push(atual);
    for (const t of trechos) {
      const b = bloco(t[Math.floor(t.length / 2)]!);
      if (v.tipo === 'pedestre') {
        const g = fita({ pontos: t, largura: v.largura }, h, 0.05);
        if (g) b.pedestre.push(g);
      } else {
        const asf = fita({ pontos: t, largura: v.largura }, h, 0.07);
        if (asf) b.asfalto.push(asf);
        if (LARGURA_CALCADA[v.tipo] > 0) {
          const cal = fita({ pontos: t, largura: v.largura + 2 * LARGURA_CALCADA[v.tipo] }, h, 0.04);
          if (cal) b.calcada.push(cal);
        }
      }
      nVias++;
    }
  }
  let nAreas = 0;
  for (const a of entrada.areas ?? []) {
    const c = a.contorno.map(local);
    if (c.every((p) => Math.max(Math.abs(p.x), Math.abs(p.z)) > limite)) continue;
    const g = poligono(c, h, a.tipo === 'agua' ? 0.03 : 0.035);
    if (!g) continue;
    const meio = c.reduce((s, p) => ({ x: s.x + p.x / c.length, z: s.z + p.z / c.length }), { x: 0, z: 0 });
    (a.tipo === 'agua' ? bloco(meio).agua : bloco(meio).verde).push(g);
    nAreas++;
  }
  // cada camada um pouco mais "na frente" que a de baixo: sem piscar de longe (calçada < pedestre < asfalto)
  const camada = (n: number) => ({ polygonOffsetFactor: -n, polygonOffsetUnits: -n * 2 });
  const mAsfalto = material(0x55565a, 0.92, camada(4));
  const mCalcada = material(0xc4bfb4, 0.9, camada(2));
  const mPedestre = material(0xcdc4b2, 0.92, camada(3));
  const mVerde = material(0x6b8f45, 1, camada(1));
  const mAgua = material(0x2f6b8c, 0.08, { metalness: 0.1, ...camada(1) });
  const pedestres: THREE.Mesh[] = [];
  for (const b of blocos.values()) {
    for (const [lista, m, sombra] of [
      [b.calcada, mCalcada, true],
      [b.asfalto, mAsfalto, true],
      [b.pedestre, mPedestre, true],
      [b.verde, mVerde, true],
      [b.agua, mAgua, false],
    ] as Array<[THREE.BufferGeometry[], THREE.Material, boolean]>) {
      if (!lista.length) continue;
      const unida = mergeGeometries(lista, false);
      lista.forEach((g) => g.dispose());
      if (!unida) continue;
      unida.computeVertexNormals();
      geos.push(unida);
      const malha = new THREE.Mesh(unida, m);
      malha.receiveShadow = sombra;
      objeto.add(malha);
      if (m === mPedestre) pedestres.push(malha);
    }
  }

  // árvores de rua
  const arvores = arvoresDeRua(vias, obstaculos, lote, h, limite);
  let malhasArvores: THREE.InstancedMesh[] = [];
  if (arvores.length) {
    const tronco = new THREE.CylinderGeometry(0.14, 0.22, 1, 6);
    tronco.translate(0, 0.5, 0);
    const copa = new THREE.IcosahedronGeometry(1, 1);
    geos.push(tronco, copa);
    const troncos = new THREE.InstancedMesh(tronco, material(0x5b4636, 0.95, { polygonOffset: false }), arvores.length);
    const copas = new THREE.InstancedMesh(copa, material(0xffffff, 0.9, { polygonOffset: false, flatShading: true }), arvores.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eixo = new THREE.Vector3(0, 1, 0);
    arvores.forEach((a, i) => {
      const t = a.altura * 0.42;
      m4.compose(new THREE.Vector3(a.x, a.y, a.z), q.identity(), new THREE.Vector3(1, t, 1));
      troncos.setMatrixAt(i, m4);
      q.setFromAxisAngle(eixo, a.tom * Math.PI * 2);
      m4.compose(new THREE.Vector3(a.x, a.y + t + a.raio * 0.8, a.z), q, new THREE.Vector3(a.raio, a.raio * 1.15, a.raio));
      copas.setMatrixAt(i, m4);
      copas.setColorAt(i, VERDE_ESCURO.clone().lerp(VERDE_CLARO, a.tom));
    });
    malhasArvores = [troncos, copas];
    for (const m of malhasArvores) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      objeto.add(m);
    }
    if (copas.instanceColor) copas.instanceColor.needsUpdate = true;
  }

  return {
    objeto,
    pisos,
    materiais,
    terreno,
    vias: nVias,
    areas: nAreas,
    arvores: arvores.length,
    definirNivel(nivel) {
      const leve = nivel === 'baixo';
      for (const m of pedestres) m.visible = !leve;
      for (const m of malhasArvores) m.visible = !leve;
    },
    destruir() {
      for (const g of geos) g.dispose();
      for (const m of materiais) m.dispose();
    },
  };
}
