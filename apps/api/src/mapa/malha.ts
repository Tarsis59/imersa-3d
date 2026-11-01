/**
 * Ruas, calçadas, áreas verdes e água do OpenStreetMap (Plano 11b, item 7). Com o relevo e os prédios, é a cidade
 * em volta do empreendimento. Também serve de grafo para o tempo a pé até os pontos próximos (item 8) e para virar a
 * fachada para a rua (item 9).
 */

export type TipoVia = 'principal' | 'secundaria' | 'local' | 'servico' | 'pedestre';
export interface Via {
  osmId: string;
  tipo: TipoVia;
  nome: string | null;
  larguraM: number;
  /** [lon, lat] */
  pontos: Array<[number, number]>;
}
export interface Area {
  osmId: string;
  tipo: 'verde' | 'agua';
  contorno: Array<[number, number]>;
}
export interface Malha {
  vias: Via[];
  areas: Area[];
}

const MAX_VIAS = 2500;
const MAX_AREAS = 400;

export function consultaMalha(lat: number, lon: number, raioM: number): string {
  const perto = `(around:${raioM},${lat},${lon})`;
  return [
    '[out:json][timeout:50];(',
    `way["highway"]${perto};`,
    `way["leisure"~"^(park|garden|playground|pitch|common|dog_park)$"]${perto};`,
    `way["landuse"~"^(grass|forest|recreation_ground|meadow|village_green|cemetery)$"]${perto};`,
    `way["natural"~"^(water|wood|scrub|grassland|wetland)$"]${perto};`,
    `way["waterway"="riverbank"]${perto};`,
    ');out geom;',
  ].join('');
}

const TIPO_VIA: Record<string, TipoVia> = {
  motorway: 'principal',
  trunk: 'principal',
  primary: 'principal',
  motorway_link: 'principal',
  trunk_link: 'principal',
  primary_link: 'principal',
  secondary: 'secundaria',
  secondary_link: 'secundaria',
  tertiary: 'secundaria',
  tertiary_link: 'secundaria',
  residential: 'local',
  unclassified: 'local',
  living_street: 'local',
  road: 'local',
  service: 'servico',
  footway: 'pedestre',
  pedestrian: 'pedestre',
  path: 'pedestre',
  steps: 'pedestre',
  cycleway: 'pedestre',
  track: 'servico',
};
const LARGURA_PADRAO: Record<TipoVia, number> = { principal: 14, secundaria: 10, local: 7, servico: 4, pedestre: 2.5 };

function largura(tipo: TipoVia, tags: Record<string, string>): number {
  const w = parseFloat(tags.width ?? '');
  if (Number.isFinite(w) && w > 0.5 && w < 80) return w;
  const faixas = parseInt(tags.lanes ?? '', 10);
  if (tipo !== 'pedestre' && Number.isFinite(faixas) && faixas > 0 && faixas < 12) return Math.max(LARGURA_PADRAO.servico, faixas * 3.2);
  return LARGURA_PADRAO[tipo];
}

function tipoArea(tags: Record<string, string>): Area['tipo'] | null {
  if (tags.natural === 'water' || tags.natural === 'wetland' || tags.waterway === 'riverbank') return 'agua';
  if (tags.leisure || tags.landuse || tags.natural) return 'verde';
  return null;
}

interface Elemento {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  nodes?: unknown;
  geometry?: unknown;
  tags?: Record<string, string>;
}

const sete = (n: number) => Math.round(n * 1e7) / 1e7;

/** Resposta do Overpass (`out geom` ou nós + vias do arquivo baixado) → vias e áreas dentro do raio. */
export function interpretarMalha(json: unknown, centro: { lat: number; lon: number }, raioM = Infinity): Malha {
  const elementos = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elementos)) return { vias: [], areas: [] };
  const nos = new Map<number, { lat: number; lon: number }>();
  for (const e of elementos as Elemento[]) if (e?.type === 'node' && Number.isInteger(e.id) && Number.isFinite(e.lat) && Number.isFinite(e.lon)) nos.set(e.id!, { lat: e.lat!, lon: e.lon! });
  const cosLat = Math.cos((centro.lat * Math.PI) / 180);
  const dist = (p: [number, number]) => Math.hypot((p[1] - centro.lat) * 110_540, (p[0] - centro.lon) * 111_320 * cosLat);
  const vias: Array<Via & { d: number }> = [];
  const areas: Array<Area & { d: number }> = [];
  const vistos = new Set<string>();
  for (const e of elementos as Elemento[]) {
    if (e?.type !== 'way' || !Number.isInteger(e.id) || !e.tags) continue;
    const osmId = `way/${e.id}`;
    if (vistos.has(osmId)) continue;
    let pontos: Array<{ lat: number; lon: number } | undefined> = [];
    if (Array.isArray(e.geometry)) pontos = (e.geometry as Array<{ lat?: unknown; lon?: unknown }>).map((g) => (Number.isFinite(g?.lat) && Number.isFinite(g?.lon) ? { lat: g.lat as number, lon: g.lon as number } : undefined));
    else if (Array.isArray(e.nodes)) pontos = (e.nodes as unknown[]).map((id) => nos.get(id as number));
    if (pontos.length < 2 || pontos.some((p) => !p)) continue;
    const lista = (pontos as Array<{ lat: number; lon: number }>).map((p): [number, number] => [sete(p.lon), sete(p.lat)]);
    const d = Math.min(...lista.map(dist));
    if (d > raioM) continue;
    const hw = e.tags.highway;
    if (hw) {
      const tipo = TIPO_VIA[hw];
      // em obra, planejada, plataforma de ônibus, túnel e passagem subterrânea: não é chão de rua
      if (!tipo || e.tags.area === 'yes' || (e.tags.tunnel && e.tags.tunnel !== 'no') || Number(e.tags.layer) < 0) continue;
      vistos.add(osmId);
      vias.push({ osmId, tipo, nome: e.tags.name?.slice(0, 120) ?? null, larguraM: largura(tipo, e.tags), pontos: lista, d });
      continue;
    }
    const tipo = tipoArea(e.tags);
    if (!tipo) continue;
    const fechado = lista[0]![0] === lista.at(-1)![0] && lista[0]![1] === lista.at(-1)![1];
    if (!fechado || lista.length < 4) continue;
    vistos.add(osmId);
    areas.push({ osmId, tipo, contorno: lista.slice(0, -1), d });
  }
  const tirarD = <T extends { d: number }>({ d: _d, ...x }: T) => x;
  return {
    vias: vias.sort((a, b) => a.d - b.d).slice(0, MAX_VIAS).map(tirarD),
    areas: areas.sort((a, b) => a.d - b.d).slice(0, MAX_AREAS).map(tirarD),
  };
}

// ---------------------------------------------------------------- geometria local (metros, x leste, z sul)

export interface Xz {
  x: number;
  z: number;
}
export const paraLocal = (p: [number, number], centro: { lat: number; lon: number }): Xz => ({
  x: (p[0] - centro.lon) * 111_320 * Math.cos((centro.lat * Math.PI) / 180),
  z: -(p[1] - centro.lat) * 110_540,
});

function pontoNoSegmento(p: Xz, a: Xz, b: Xz): { ponto: Xz; t: number; d: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  const ponto = { x: a.x + dx * t, z: a.z + dz * t };
  return { ponto, t, d: Math.hypot(p.x - ponto.x, p.z - ponto.z) };
}

/** Rua de carro mais perto do centro (calçada e serviço não contam: a fachada vira para a rua de verdade). */
export function ruaMaisPerto(vias: readonly Via[], centro: { lat: number; lon: number }): { via: Via; ponto: Xz; distanciaM: number; direcao: Xz } | null {
  let melhor: { via: Via; ponto: Xz; distanciaM: number; direcao: Xz } | null = null;
  for (const v of vias) {
    if (v.tipo === 'pedestre' || v.tipo === 'servico') continue;
    const pts = v.pontos.map((p) => paraLocal(p, centro));
    for (let i = 1; i < pts.length; i++) {
      const r = pontoNoSegmento({ x: 0, z: 0 }, pts[i - 1]!, pts[i]!);
      if (!melhor || r.d < melhor.distanciaM) {
        const l = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z) || 1;
        melhor = { via: v, ponto: r.ponto, distanciaM: r.d, direcao: { x: (pts[i]!.x - pts[i - 1]!.x) / l, z: (pts[i]!.z - pts[i - 1]!.z) / l } };
      }
    }
  }
  return melhor;
}

/**
 * Giro do prédio (graus, a mesma convenção do 3D em `entornoParaLocal`) para a fachada da entrada (+z do modelo)
 * olhar para o ponto `alvo` (x leste, z sul). O +z do modelo vai para (−sen θ, cos θ) no chão.
 */
export function giroParaOlhar(alvo: Xz): number {
  const g = (Math.atan2(-alvo.x, alvo.z) * 180) / Math.PI;
  return Math.round(g * 10) / 10;
}

/**
 * Assentar o prédio no lote: se o ponto do endereço cai na rua (o Nominatim costuma devolver o eixo da rua), anda o
 * centro para trás da calçada, do lado em que já estava (ou à esquerda da rua, se estava bem no meio).
 */
export function recuoDaRua(rua: { ponto: Xz; distanciaM: number; direcao: Xz; via: Via }, meiaProfundidadeM: number, recuoM = 4): Xz | null {
  const precisa = rua.via.larguraM / 2 + recuoM + meiaProfundidadeM;
  if (rua.distanciaM >= precisa) return null;
  let nx = -rua.ponto.x;
  let nz = -rua.ponto.z;
  const l = Math.hypot(nx, nz);
  if (l < 0.5) {
    nx = rua.direcao.z;
    nz = -rua.direcao.x;
  } else {
    nx /= l;
    nz /= l;
  }
  return { x: rua.ponto.x + nx * precisa, z: rua.ponto.z + nz * precisa };
}

// ---------------------------------------------------------------- caminho a pé (item 8)

const A_PE = new Set<TipoVia>(['principal', 'secundaria', 'local', 'servico', 'pedestre']);

/**
 * Distâncias a pé pelo desenho das ruas (Dijkstra no grafo do OSM): do centro até cada destino. Entra e sai do grafo
 * pelo nó mais perto (a pé em linha reta até ele). `null` quando o destino está fora da malha baixada.
 */
export function distanciasAPe(vias: readonly Via[], centro: { lat: number; lon: number }, destinos: ReadonlyArray<{ lat: number; lon: number }>, folgaM = 150): Array<number | null> {
  const ids = new Map<string, number>();
  const pos: Xz[] = [];
  const adj: Array<Array<[number, number]>> = [];
  const no = (p: [number, number]) => {
    const k = `${p[0]},${p[1]}`;
    let i = ids.get(k);
    if (i === undefined) {
      i = pos.length;
      ids.set(k, i);
      pos.push(paraLocal(p, centro));
      adj.push([]);
    }
    return i;
  };
  for (const v of vias) {
    if (!A_PE.has(v.tipo)) continue;
    for (let i = 1; i < v.pontos.length; i++) {
      const a = no(v.pontos[i - 1]!);
      const b = no(v.pontos[i]!);
      const d = Math.hypot(pos[a]!.x - pos[b]!.x, pos[a]!.z - pos[b]!.z);
      adj[a]!.push([b, d]);
      adj[b]!.push([a, d]);
    }
  }
  if (!pos.length) return destinos.map(() => null);
  const maisPerto = (p: Xz) => {
    let m = 0;
    let dm = Infinity;
    for (let i = 0; i < pos.length; i++) {
      const d = Math.hypot(pos[i]!.x - p.x, pos[i]!.z - p.z);
      if (d < dm) {
        dm = d;
        m = i;
      }
    }
    return { i: m, d: dm };
  };
  const inicio = maisPerto({ x: 0, z: 0 });
  if (inicio.d > folgaM) return destinos.map(() => null);
  // Dijkstra com fila de prioridade simples (heap binário)
  const dist = new Float64Array(pos.length).fill(Infinity);
  dist[inicio.i] = inicio.d;
  const heap: Array<[number, number]> = [[inicio.d, inicio.i]];
  const subir = (k: number) => {
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p]![0] <= heap[k]![0]) break;
      [heap[p], heap[k]] = [heap[k]!, heap[p]!];
      k = p;
    }
  };
  const descer = (k: number) => {
    for (;;) {
      const l = 2 * k + 1;
      const r = l + 1;
      let m = k;
      if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
      if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
      if (m === k) break;
      [heap[m], heap[k]] = [heap[k]!, heap[m]!];
      k = m;
    }
  };
  while (heap.length) {
    const [d, u] = heap[0]!;
    const ultimo = heap.pop()!;
    if (heap.length) {
      heap[0] = ultimo;
      descer(0);
    }
    if (d > dist[u]!) continue;
    for (const [v, w] of adj[u]!) {
      if (d + w < dist[v]!) {
        dist[v] = d + w;
        heap.push([d + w, v]);
        subir(heap.length - 1);
      }
    }
  }
  return destinos.map((t) => {
    const p = paraLocal([t.lon, t.lat], centro);
    const fim = maisPerto(p);
    if (fim.d > folgaM || !Number.isFinite(dist[fim.i]!)) return null;
    return Math.round(dist[fim.i]! + fim.d);
  });
}
