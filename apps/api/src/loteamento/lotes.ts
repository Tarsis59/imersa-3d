import type { Dxf } from './dxf';
import { utmParaLatLon } from './utm';

/**
 * Lotes do parcelamento como dado (Plano 12d): cada polilinha fechada no layer dos lotes vira um lote com quadra,
 * número, área, frente e fundo calculados do desenho oficial; o contorno sai em [lon, lat] para o mapa e o 3D.
 */
export interface LoteLido {
  quadra: string;
  numero: string;
  areaM2: number;
  frenteM: number;
  fundoM: number;
  contorno: Array<[number, number]>;
  preco?: number | null;
  status?: 'disponivel' | 'reservado' | 'vendido' | 'bloqueado';
}
export interface Leitura {
  lotes: LoteLido[];
  avisos: string[];
}

type P = [number, number];

/** Área pela fórmula do laço (coordenadas em metros). */
export function areaPoligono(p: readonly P[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]!;
    const [x2, y2] = p[(i + 1) % p.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function dentro(pt: P, poligono: readonly P[]): boolean {
  let d = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i]!;
    const [xj, yj] = poligono[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

const centroide = (p: readonly P[]): P => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

/**
 * Frente × fundo pelo menor retângulo que envolve o lote (testando a direção de cada lado): num lote retangular dá
 * as medidas exatas; num irregular, as de referência (a área continua a do desenho).
 */
export function frenteFundo(p: readonly P[]): { frente: number; fundo: number } {
  let melhor = { area: Infinity, a: 0, b: 0 };
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]!;
    const [x2, y2] = p[(i + 1) % p.length]!;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const c = Math.cos(-ang);
    const s = Math.sin(-ang);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of p) {
      const u = x * c - y * s;
      const v = x * s + y * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const a = maxU - minU;
    const b = maxV - minV;
    if (a * b < melhor.area) melhor = { area: a * b, a, b };
  }
  return { frente: Math.min(melhor.a, melhor.b), fundo: Math.max(melhor.a, melhor.b) };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "Q-04", "QUADRA 4", "Qd 04" → "04"; "12" → "12"; "L12" / "LOTE 12" → "12". */
export function numeroLimpo(t: string): string | null {
  const m = t.trim().toUpperCase().match(/^(?:Q(?:UADRA|D)?|L(?:OTE)?)?\s*[-.:]?\s*0*(\d{1,4}[A-Z]?)$/);
  return m ? m[1]!.padStart(2, '0') : null;
}

export interface OpcoesDxf {
  /** Fuso UTM do levantamento (Brasil: 18 a 25). Sem fuso: o DXF já está em lon/lat (graus). */
  fuso?: number;
  sul?: boolean;
  camadaLotes?: RegExp;
  camadaQuadras?: RegExp;
}

export function lotesDoDxf(dxf: Dxf, o: OpcoesDxf = {}): Leitura {
  const avisos: string[] = [];
  const reLotes = o.camadaLotes ?? /lote/i;
  const reQuadras = o.camadaQuadras ?? /quadra/i;
  const lotesPoli = dxf.polilinhas.filter((p) => p.fechada && reLotes.test(p.camada));
  const quadrasPoli = dxf.polilinhas.filter((p) => p.fechada && reQuadras.test(p.camada));
  if (!lotesPoli.length) return { lotes: [], avisos: ['Nenhuma polilinha fechada no layer dos lotes (ex.: LOTES).'] };
  const emGraus = o.fuso === undefined;
  if (emGraus && lotesPoli.some((p) => p.pontos.some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90))) {
    return { lotes: [], avisos: ['O desenho está em metros (UTM): informe o fuso do levantamento (ex.: 23 para São Paulo).'] };
  }
  // em graus, a área sai de uma projeção local em metros (o loteamento cabe em poucos km)
  const ref = lotesPoli[0]!.pontos[0]!;
  const emMetros = (q: P): P => (emGraus ? [(q[0] - ref[0]) * 111_320 * Math.cos((ref[1] * Math.PI) / 180), (q[1] - ref[1]) * 110_540] : q);
  const paraLonLat = (q: P): P => {
    if (emGraus) return q;
    const g = utmParaLatLon(q[0], q[1], o.fuso!, o.sul ?? true);
    return [Math.round(g.lon * 1e8) / 1e8, Math.round(g.lat * 1e8) / 1e8];
  };
  const nomeQuadra = (poligono: readonly P[]) => {
    for (const t of dxf.textos) if (dentro([t.x, t.y], poligono) && /^Q/i.test(t.texto.trim())) return numeroLimpo(t.texto);
    return null;
  };
  const quadras = quadrasPoli.map((q) => ({ poligono: q.pontos, nome: nomeQuadra(q.pontos) }));

  const lotes: LoteLido[] = [];
  const vistos = new Set<string>();
  for (const [k, poli] of lotesPoli.entries()) {
    const c = centroide(poli.pontos);
    // número: o texto dentro do lote que não é o nome da quadra (o mais perto do meio)
    const textos = dxf.textos.filter((t) => dentro([t.x, t.y], poli.pontos) && !/^Q/i.test(t.texto.trim()));
    textos.sort((a, b) => Math.hypot(a.x - c[0], a.y - c[1]) - Math.hypot(b.x - c[0], b.y - c[1]));
    const numero = textos.map((t) => numeroLimpo(t.texto)).find(Boolean) ?? null;
    const quadra = quadras.find((q) => dentro(c, q.poligono))?.nome ?? null;
    if (!numero) {
      avisos.push(`Lote ${k + 1} do desenho sem número dentro dele (ficou de fora).`);
      continue;
    }
    if (!quadra) {
      avisos.push(`Lote ${numero} fora de uma quadra com nome (ficou de fora).`);
      continue;
    }
    const chave = `${quadra}-${numero}`;
    if (vistos.has(chave)) {
      avisos.push(`Lote ${numero} da quadra ${quadra} aparece duas vezes (ficou só o primeiro).`);
      continue;
    }
    vistos.add(chave);
    const m = poli.pontos.map(emMetros);
    const { frente, fundo } = frenteFundo(m);
    lotes.push({ quadra, numero, areaM2: r2(areaPoligono(m)), frenteM: r2(frente), fundoM: r2(fundo), contorno: poli.pontos.map(paraLonLat) });
  }
  lotes.sort((a, b) => a.quadra.localeCompare(b.quadra, 'pt-BR', { numeric: true }) || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
  return { lotes, avisos };
}

/**
 * GeoJSON do QGIS (EPSG:4326): polígonos com as propriedades `quadra` e `lote` (ou `numero`); `preco` e `status`
 * opcionais. A área e as medidas saem do desenho; uma área informada que difere mais de 1% vira aviso.
 */
export function lotesDoGeoJson(g: unknown): Leitura {
  const avisos: string[] = [];
  const feicoes = (g as { features?: unknown[] })?.features;
  if (!Array.isArray(feicoes)) return { lotes: [], avisos: ['GeoJSON sem "features".'] };
  const lotes: LoteLido[] = [];
  const vistos = new Set<string>();
  for (const [k, f] of feicoes.entries()) {
    const geo = (f as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
    const props = ((f as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>;
    const anel = geo?.type === 'Polygon' ? (geo.coordinates as P[][])[0] : geo?.type === 'MultiPolygon' ? (geo.coordinates as P[][][])[0]?.[0] : null;
    const quadra = numeroLimpo(String(props.quadra ?? props.QUADRA ?? ''));
    const numero = numeroLimpo(String(props.lote ?? props.LOTE ?? props.numero ?? props.NUMERO ?? ''));
    if (!anel || anel.length < 4 || !quadra || !numero) {
      avisos.push(`Feição ${k + 1} sem polígono, quadra ou lote (ficou de fora).`);
      continue;
    }
    if (vistos.has(`${quadra}-${numero}`)) {
      avisos.push(`Lote ${numero} da quadra ${quadra} aparece duas vezes (ficou só o primeiro).`);
      continue;
    }
    vistos.add(`${quadra}-${numero}`);
    const pontos = anel.slice(0, -1).map(([lon, lat]) => [Number(lon), Number(lat)] as P);
    const ref = pontos[0]!;
    const m = pontos.map(([lon, lat]) => [(lon - ref[0]) * 111_320 * Math.cos((ref[1] * Math.PI) / 180), (lat - ref[1]) * 110_540] as P);
    const area = r2(areaPoligono(m));
    const informada = Number(props.area_m2 ?? props.area);
    if (Number.isFinite(informada) && informada > 0 && Math.abs(informada - area) / informada > 0.01) {
      avisos.push(`Lote ${numero} da quadra ${quadra}: área do desenho ${area} m² difere da informada ${informada} m².`);
    }
    const { frente, fundo } = frenteFundo(m);
    const preco = Number(props.preco);
    const status = String(props.status ?? '');
    lotes.push({
      quadra,
      numero,
      areaM2: area,
      frenteM: r2(frente),
      fundoM: r2(fundo),
      contorno: pontos,
      ...(Number.isFinite(preco) && preco >= 0 && props.preco !== undefined ? { preco } : {}),
      ...(['disponivel', 'reservado', 'vendido', 'bloqueado'].includes(status) ? { status: status as LoteLido['status'] } : {}),
    });
  }
  return { lotes, avisos };
}
