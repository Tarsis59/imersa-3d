/**
 * Planta conferida no editor → peças 3D (em metros, Y para cima). Paredes viram blocos com os vãos recortados;
 * porta = vão até a altura da porta + verga em cima + folha; janela = peitoril + verga + vidro; passagem = vão
 * inteiro. Cada peça leva o tipo IFC (IfcWall, IfcDoor, IfcWindow, IfcSlab): o configurador e a Vitrine tratam o
 * modelo como um BIM.
 */
export interface SegmentoPx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  espessura: number;
}
export interface AberturaPx extends SegmentoPx {
  tipo: 'porta' | 'janela' | 'passagem';
}
export interface EdicaoPlanta {
  escalaMPorPx: number;
  alturaParedeM: number;
  alturaPortaM: number;
  peitorilM: number;
  alturaJanelaM: number;
  paredes: SegmentoPx[];
  aberturas: AberturaPx[];
}

export type TipoBloco = 'IfcWall' | 'IfcDoor' | 'IfcWindow' | 'IfcSlab';
export interface Bloco {
  tipo: TipoBloco;
  /** centro (x, y, z) em metros; y para cima */
  centro: [number, number, number];
  /** comprimento (ao longo da parede), altura, espessura */
  tamanho: [number, number, number];
  /** giro em torno de Y (rad) */
  giroY: number;
}

const ESPESSURA_FOLHA_M = 0.04;
const ESPESSURA_VIDRO_M = 0.02;
const ESPESSURA_PISO_M = 0.1;

/** Intervalos [a, b] tirados de [0, total] (vãos sobre a parede), na ordem. */
export function subtrairIntervalos(total: number, vaos: ReadonlyArray<[number, number]>): Array<[number, number]> {
  const ordenados = vaos.map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(total, Math.max(a, b))] as [number, number]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const pedacos: Array<[number, number]> = [];
  let inicio = 0;
  for (const [a, b] of ordenados) {
    if (a > inicio) pedacos.push([inicio, a]);
    inicio = Math.max(inicio, b);
  }
  if (inicio < total) pedacos.push([inicio, total]);
  return pedacos.filter(([a, b]) => b - a > 1e-6);
}

/** Centro do desenho (px): as paredes ficam em volta da origem. */
function centroDasParedes(e: EdicaoPlanta): [number, number] {
  const xs = e.paredes.flatMap((p) => [p.x1, p.x2]);
  const ys = e.paredes.flatMap((p) => [p.y1, p.y2]);
  if (!xs.length) return [0, 0];
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export function blocosDaPlanta(e: EdicaoPlanta): Bloco[] {
  const s = e.escalaMPorPx;
  const [cx, cy] = centroDasParedes(e);
  const m = (x: number, y: number): [number, number] => [(x - cx) * s, (y - cy) * s];
  const blocos: Bloco[] = [];
  /** bloco ao longo do segmento a→b (em metros), do trecho [t0, t1] (m), entre as alturas y0 e y1 */
  const ao_longo = (tipo: TipoBloco, a: [number, number], b: [number, number], t0: number, t1: number, y0: number, y1: number, espessura: number) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const comp = Math.hypot(dx, dz);
    if (comp === 0 || t1 <= t0 || y1 <= y0) return;
    const ux = dx / comp;
    const uz = dz / comp;
    const meio = (t0 + t1) / 2;
    blocos.push({ tipo, centro: [a[0] + ux * meio, (y0 + y1) / 2, a[1] + uz * meio], tamanho: [t1 - t0, y1 - y0, espessura], giroY: -Math.atan2(dz, dx) });
  };

  for (const p of e.paredes) {
    const a = m(p.x1, p.y1);
    const b = m(p.x2, p.y2);
    const comp = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (comp === 0) continue;
    const ux = (b[0] - a[0]) / comp;
    const uz = (b[1] - a[1]) / comp;
    const esp = p.espessura * s;
    // vãos desenhados por cima desta parede (no editor, porta/janela inserida numa parede inteira)
    const vaos: Array<[number, number]> = [];
    for (const v of e.aberturas) {
      const va = m(v.x1, v.y1);
      const vb = m(v.x2, v.y2);
      const meio: [number, number] = [(va[0] + vb[0]) / 2 - a[0], (va[1] + vb[1]) / 2 - a[1]];
      const distancia = Math.abs(meio[0] * uz - meio[1] * ux);
      const ta = (va[0] - a[0]) * ux + (va[1] - a[1]) * uz;
      const tb = (vb[0] - a[0]) * ux + (vb[1] - a[1]) * uz;
      const paralelo = Math.abs(((vb[0] - va[0]) * ux + (vb[1] - va[1]) * uz) / (Math.hypot(vb[0] - va[0], vb[1] - va[1]) || 1)) > 0.95;
      if (paralelo && distancia <= esp / 2 + 1e-6 && Math.max(ta, tb) > 0 && Math.min(ta, tb) < comp) vaos.push([ta, tb]);
    }
    for (const [t0, t1] of subtrairIntervalos(comp, vaos)) ao_longo('IfcWall', a, b, t0, t1, 0, e.alturaParedeM, esp);
  }

  for (const v of e.aberturas) {
    const a = m(v.x1, v.y1);
    const b = m(v.x2, v.y2);
    const comp = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const esp = v.espessura * s;
    if (v.tipo === 'porta') {
      const alt = Math.min(e.alturaPortaM, e.alturaParedeM);
      ao_longo('IfcWall', a, b, 0, comp, alt, e.alturaParedeM, esp); // verga
      ao_longo('IfcDoor', a, b, 0, comp, 0, alt, ESPESSURA_FOLHA_M);
    } else if (v.tipo === 'janela') {
      const base = Math.min(e.peitorilM, e.alturaParedeM);
      const topo = Math.min(e.peitorilM + e.alturaJanelaM, e.alturaParedeM);
      ao_longo('IfcWall', a, b, 0, comp, 0, base, esp); // peitoril
      ao_longo('IfcWall', a, b, 0, comp, topo, e.alturaParedeM, esp); // verga
      ao_longo('IfcWindow', a, b, 0, comp, base, topo, ESPESSURA_VIDRO_M);
    }
  }

  // piso: o retângulo que cobre as paredes (até a face externa)
  if (e.paredes.length) {
    const xs = e.paredes.flatMap((p) => [m(p.x1, p.y1)[0], m(p.x2, p.y2)[0]]);
    const zs = e.paredes.flatMap((p) => [m(p.x1, p.y1)[1], m(p.x2, p.y2)[1]]);
    const borda = Math.max(...e.paredes.map((p) => p.espessura)) * s / 2;
    const x0 = Math.min(...xs) - borda;
    const x1 = Math.max(...xs) + borda;
    const z0 = Math.min(...zs) - borda;
    const z1 = Math.max(...zs) + borda;
    blocos.push({ tipo: 'IfcSlab', centro: [(x0 + x1) / 2, -ESPESSURA_PISO_M / 2, (z0 + z1) / 2], tamanho: [x1 - x0, ESPESSURA_PISO_M, z1 - z0], giroY: 0 });
  }
  return blocos;
}
