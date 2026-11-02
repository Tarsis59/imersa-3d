import * as THREE from 'three';
import { lonLatToLocal, type LonLat } from '../geo/project';
import type { StatusUnidade } from '../units/tipos';
import { paraModelo } from './cidade';

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

export interface LotesNoChao {
  objeto: THREE.Group;
  /** Lote do triângulo tocado (raio contra `preenchimento`). */
  idDoTriangulo(face: number): string | null;
  preenchimento: THREE.Mesh;
  /** Centro de cada lote e de cada quadra no chão do 3D (etiquetas, voo, quadra no buscador). */
  centros: Map<string, THREE.Vector3>;
  quadras: Map<string, THREE.Vector3>;
  caixa: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Repinta: situação de cada lote e quem passou no filtro (os outros ficam apagados). */
  pintar(status: ReadonlyMap<string, StatusUnidade>, passam: ReadonlySet<string> | null): void;
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
  geo.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
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
        // fora do filtro: quase transparente (some no chão), como no buscador do vídeo
        if (passam && !passam.has(id)) cor.lerp(new THREE.Color(0x1b2430), 0.75);
        for (let i = de; i < ate; i++) atributoCor.setXYZ(i, cor.r, cor.g, cor.b);
      }
      atributoCor.needsUpdate = true;
    },
    destruir() {
      geo.dispose();
      geoLinhas.dispose();
      material.dispose();
      matLinhas.dispose();
    },
  };
}
