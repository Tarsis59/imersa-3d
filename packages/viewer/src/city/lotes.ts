import * as THREE from 'three';
import { lonLatToLocal, type LonLat } from '../geo/project';
import type { StatusUnidade } from '../units/tipos';
import { paraModelo, type Xz } from './cidade';
import { footprintConstrutivo, type FootprintCasa } from './casaModelo';

/** Lote do loteamento no 3D (Plano 12d): contorno em [lon, lat] e a situação de venda. */
export interface LoteViewer {
  id: string;
  quadra: string;
  numero: string;
  status: StatusUnidade;
  contorno: ReadonlyArray<readonly [number, number]>;
}

/** Cores do vídeo do loteamento: azul disponível, amarelo reservado, vermelho vendido (bloqueado em cinza). */
export const COR_LOTE: Record<StatusUnidade, number> = { disponivel: 0x2f7fe0, reservado: 0xf2b417, vendido: 0xd9363e, bloqueado: 0x8a8f98 };

/** Ciano da varredura (Plano 12d, item 4). */
const COR_VARREDURA = new THREE.Vector3(0.3, 0.95, 1.0);
/** "Ver daqui" (item 11): metros entre a câmera e o lado da frente (recuo + calçada). */
const DISTANCIA_CALCADA_VISTA = 3;
/** Liga/desliga o custo da varredura no shader pelo nível de qualidade (objeto compartilhado: sobrevive a recriar os lotes). */
export const DETALHE_VARREDURA = { value: 1 };

export interface LotesNoChao {
  objeto: THREE.Group;
  /** Lote do triângulo tocado (raio contra `preenchimento`). */
  idDoTriangulo(face: number): string | null;
  preenchimento: THREE.Mesh;
  /** Centro de cada lote e de cada quadra no chão do 3D (etiquetas, voo, quadra no buscador). */
  centros: Map<string, THREE.Vector3>;
  quadras: Map<string, THREE.Vector3>;
  caixa: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** "Ver daqui" (item 11): ponto na calçada em frente ao lote (x, z) e para onde olhar (alvoX, alvoZ). */
  vistas: Map<string, { x: number; z: number; alvoX: number; alvoZ: number }>;
  /** Casa-modelo (item 9): o retângulo construtivo do lote, já com os recuos e virado para a frente. `null` sem esse lote (ou lote pequeno demais para os recuos). */
  footprint(id: string): FootprintCasa | null;
  /** Repinta: situação de cada lote e quem passou no filtro (os outros ficam apagados). */
  pintar(status: ReadonlyMap<string, StatusUnidade>, passam: ReadonlySet<string> | null): void;
  /**
   * Varredura em ciano (Plano 12d, item 4): anel que se expande do centro do loteamento (`t` de 0 a 1, onde 1 chega
   * à ponta mais longe) e acende só os lotes que passam no filtro atual. Com "menos movimento" o chamador avança
   * `t` direto para 1 (acende sem animar, como o resto do viewer faz com voos e giros).
   */
  definirVarredura(ativa: boolean, t: number): void;
  destruir(): void;
}

/**
 * Todos os lotes numa malha só (um desenho para o loteamento inteiro, mesmo com centenas de lotes), com a cor de
 * cada lote nos vértices, um pouco acima do chão; e os contornos em linhas brancas.
 */
export function criarLotes(lotes: readonly LoteViewer[], centro: LonLat, rotacaoGraus: number, altura: (x: number, z: number) => number = () => 0): LotesNoChao {
  const posicoes: number[] = [];
  const cores: number[] = [];
  const linhas: number[] = [];
  const faixas: Array<{ id: string; ate: number }> = [];
  const centros = new Map<string, THREE.Vector3>();
  const vistas = new Map<string, { x: number; z: number; alvoX: number; alvoZ: number }>();
  // guardado para a casa-modelo (item 9), que só precisa calcular o footprint do lote escolhido, não de todos
  const pontosPorLote = new Map<string, Xz[]>();
  const frentesPorLote = new Map<string, Xz>();
  const somaQuadra = new Map<string, { x: number; z: number; n: number }>();
  const caixa = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const verticesDoLote = new Map<string, [number, number]>();
  const cor = new THREE.Color();
  for (const l of lotes) {
    const pts = l.contorno.map(([lon, lat]) => paraModelo(lonLatToLocal({ lon, lat }, centro), rotacaoGraus));
    if (pts.length < 3) continue;
    // ShapeGeometry triangula no plano XY; o chão do 3D é XZ (z = -y)
    const forma = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ShapeGeometry(forma);
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const tri = idx ? Array.from(idx.array) : [...Array(pos.count).keys()];
    const inicio = posicoes.length / 3;
    cor.setHex(COR_LOTE[l.status]);
    for (const i of tri) {
      const x = pos.getX(i);
      const z = -pos.getY(i);
      posicoes.push(x, altura(x, z) + 0.12, z);
      cores.push(cor.r, cor.g, cor.b);
    }
    g.dispose();
    verticesDoLote.set(l.id, [inicio, posicoes.length / 3]);
    faixas.push({ id: l.id, ate: posicoes.length / 9 });
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      linhas.push(a.x, altura(a.x, a.z) + 0.18, a.z, b.x, altura(b.x, b.z) + 0.18, b.z);
    }
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    centros.set(l.id, new THREE.Vector3(cx, altura(cx, cz), cz));
    // "Ver daqui" (item 11): sem saber onde fica a rua (o terreno do item 8 é por prédio, não por lote aqui), a
    // mesma hipótese do item 6 sem via — o maior lado do polígono é a frente; a câmera fica na calçada, 3 m para
    // fora dele, olhando para o meio do lote.
    let frente: { comprimento: number; mx: number; mz: number; nx: number; nz: number } | null = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const comprimento = Math.hypot(dx, dz);
      if (comprimento < 1e-6 || (frente && comprimento <= frente.comprimento)) continue;
      let nx = dz / comprimento;
      let nz = -dx / comprimento;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      if ((mx - cx) * nx + (mz - cz) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      frente = { comprimento, mx, mz, nx, nz };
    }
    if (frente) {
      vistas.set(l.id, { x: frente.mx + frente.nx * DISTANCIA_CALCADA_VISTA, z: frente.mz + frente.nz * DISTANCIA_CALCADA_VISTA, alvoX: cx, alvoZ: cz });
      pontosPorLote.set(l.id, pts);
      frentesPorLote.set(l.id, { x: frente.nx, z: frente.nz });
    }
    const q = somaQuadra.get(l.quadra) ?? { x: 0, z: 0, n: 0 };
    somaQuadra.set(l.quadra, { x: q.x + cx, z: q.z + cz, n: q.n + 1 });
    for (const p of pts) {
      caixa.minX = Math.min(caixa.minX, p.x);
      caixa.maxX = Math.max(caixa.maxX, p.x);
      caixa.minZ = Math.min(caixa.minZ, p.z);
      caixa.maxZ = Math.max(caixa.maxZ, p.z);
    }
  }
  const quadras = new Map([...somaQuadra].map(([k, q]) => [k, new THREE.Vector3(q.x / q.n, altura(q.x / q.n, q.z / q.n), q.z / q.n)]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posicoes, 3));
  const atributoCor = new THREE.Float32BufferAttribute(cores, 3);
  geo.setAttribute('color', atributoCor);
  // 1 = lote passa no filtro atual (acende na varredura); 0 = apagado (não acende mesmo com a varredura passando)
  const atributoPassou = new THREE.Float32BufferAttribute(new Float32Array(posicoes.length / 3).fill(1), 1);
  geo.setAttribute('aPassou', atributoPassou);
  geo.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // centro e raio do loteamento (da caixa que envolve todos os lotes): a varredura parte do meio e cobre tudo em t = 1
  const centroVarreduraX = Number.isFinite(caixa.minX) ? (caixa.minX + caixa.maxX) / 2 : 0;
  const centroVarreduraZ = Number.isFinite(caixa.minZ) ? (caixa.minZ + caixa.maxZ) / 2 : 0;
  const raioVarredura = Math.max(1, Math.hypot(caixa.maxX - centroVarreduraX, caixa.maxZ - centroVarreduraZ));
  const uT = { value: 0 };
  const uAtiva = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVarreduraCentro = { value: new THREE.Vector2(centroVarreduraX, centroVarreduraZ) };
    shader.uniforms.uVarreduraRaio = { value: raioVarredura };
    shader.uniforms.uVarreduraT = uT;
    shader.uniforms.uVarreduraAtiva = uAtiva;
    shader.uniforms.uVarreduraDetalhe = DETALHE_VARREDURA;
    shader.uniforms.uVarreduraCor = { value: COR_VARREDURA };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPassou;\nvarying vec2 vVarreduraXZ;\nvarying float vPassou;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVarreduraXZ = (modelMatrix * vec4(transformed, 1.0)).xz;\nvPassou = aPassou;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vVarreduraXZ;\nvarying float vPassou;\nuniform vec2 uVarreduraCentro;\nuniform float uVarreduraRaio;\nuniform float uVarreduraT;\nuniform float uVarreduraAtiva;\nuniform float uVarreduraDetalhe;\nuniform vec3 uVarreduraCor;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // varredura em ciano (Plano 12d, item 4): anel que se expande do centro do loteamento, só nos lotes do filtro
        float vDist = length(vVarreduraXZ - uVarreduraCentro);
        float vRaioAnel = uVarreduraT * uVarreduraRaio * 1.05;
        float vFaixa = max(2.0, uVarreduraRaio * 0.08);
        float vAnel = (1.0 - smoothstep(0.0, vFaixa, abs(vDist - vRaioAnel))) * uVarreduraAtiva * uVarreduraDetalhe * vPassou;
        diffuseColor.rgb = mix(diffuseColor.rgb, uVarreduraCor, vAnel * 0.85);`,
      );
  };
  const preenchimento = new THREE.Mesh(geo, material);
  preenchimento.name = 'lotes';
  preenchimento.renderOrder = 4;
  const geoLinhas = new THREE.BufferGeometry();
  geoLinhas.setAttribute('position', new THREE.Float32BufferAttribute(linhas, 3));
  const matLinhas = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const contornos = new THREE.LineSegments(geoLinhas, matLinhas);
  contornos.renderOrder = 5;
  const objeto = new THREE.Group();
  objeto.name = 'loteamento';
  objeto.add(preenchimento, contornos);
  return {
    objeto,
    preenchimento,
    centros,
    quadras,
    caixa,
    vistas,
    footprint(id) {
      const pts = pontosPorLote.get(id);
      const normal = frentesPorLote.get(id);
      const centro = centros.get(id);
      if (!pts || !normal || !centro) return null;
      return footprintConstrutivo(pts, { x: centro.x, z: centro.z }, normal);
    },
    idDoTriangulo(face) {
      // busca binária nas faixas de triângulos de cada lote
      let a = 0;
      let b = faixas.length - 1;
      while (a < b) {
        const m = (a + b) >> 1;
        if (face < faixas[m]!.ate) b = m;
        else a = m + 1;
      }
      return faixas[a] && face < faixas[a]!.ate ? faixas[a]!.id : null;
    },
    pintar(status, passam) {
      for (const [id, [de, ate]] of verticesDoLote) {
        cor.setHex(COR_LOTE[status.get(id) ?? 'disponivel']);
        const passa = !passam || passam.has(id);
        // fora do filtro: quase transparente (some no chão), como no buscador do vídeo
        if (!passa) cor.lerp(new THREE.Color(0x1b2430), 0.75);
        for (let i = de; i < ate; i++) {
          atributoCor.setXYZ(i, cor.r, cor.g, cor.b);
          atributoPassou.setX(i, passa ? 1 : 0);
        }
      }
      atributoCor.needsUpdate = true;
      atributoPassou.needsUpdate = true;
    },
    definirVarredura(ativa, t) {
      uAtiva.value = ativa ? 1 : 0;
      uT.value = THREE.MathUtils.clamp(t, 0, 1);
    },
    destruir() {
      geo.dispose();
      geoLinhas.dispose();
      material.dispose();
      matLinhas.dispose();
    },
  };
}
