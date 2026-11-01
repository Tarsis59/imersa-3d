import { readFile } from 'node:fs/promises';
import { interpretarViaCep, type EnderecoCep } from '../criacao/local';
export type CategoriaPoi = 'escola' | 'saude' | 'mercado' | 'farmacia' | 'transporte' | 'parque' | 'outro';

export interface PoiOsm {
  osmId: string;
  categoria: CategoriaPoi;
  nome: string;
  lat: number;
  lon: number;
}

export interface Endereco {
  rotulo: string;
  lat: number;
  lon: number;
}

export function categorizar(tags: Record<string, string>): CategoriaPoi | null {
  const a = tags.amenity;
  if (a === 'school' || a === 'kindergarten' || a === 'university' || a === 'college') return 'escola';
  if (a === 'hospital' || a === 'clinic') return 'saude';
  if (a === 'pharmacy') return 'farmacia';
  if (tags.shop === 'supermarket') return 'mercado';
  if (tags.railway === 'station' || tags.public_transport === 'station') return 'transporte';
  if (tags.leisure === 'park') return 'parque';
  return null;
}

export function consultaOverpass(lat: number, lon: number, raioM: number): string {
  const perto = `(around:${raioM},${lat},${lon})`;
  return [
    '[out:json][timeout:25];(',
    `nwr["amenity"~"^(school|kindergarten|university|college|hospital|clinic|pharmacy)$"]${perto};`,
    `nwr["shop"="supermarket"]${perto};`,
    `nwr["railway"="station"]${perto};`,
    `nwr["public_transport"="station"]${perto};`,
    `nwr["leisure"="park"]["name"]${perto};`,
    ');out center tags;',
  ].join('');
}

interface ElementoOverpass {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

export function interpretarOverpass(json: unknown): PoiOsm[] {
  const elementos = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elementos)) return [];
  const vistos = new Set<string>();
  const pois: PoiOsm[] = [];
  for (const e of elementos as ElementoOverpass[]) {
    if (!e || !['node', 'way', 'relation'].includes(e.type ?? '') || !Number.isInteger(e.id)) continue;
    const nome = e.tags?.name?.trim();
    const categoria = e.tags ? categorizar(e.tags) : null;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!nome || !categoria || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const osmId = `${e.type}/${e.id}`;
    if (vistos.has(osmId)) continue;
    vistos.add(osmId);
    pois.push({ osmId, categoria, nome: nome.slice(0, 200), lat: lat!, lon: lon! });
  }
  return pois;
}

export function interpretarNominatim(json: unknown): Endereco[] {
  if (!Array.isArray(json)) return [];
  return (json as Array<{ display_name?: string; lat?: string; lon?: string }>)
    .map((r) => ({ rotulo: String(r.display_name ?? ''), lat: Number(r.lat), lon: Number(r.lon) }))
    .filter((r) => r.rotulo && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

/** Garante um intervalo mínimo entre chamadas (regra de uso do Nominatim: no máximo 1 por segundo). */
export function espacar(intervaloMs: number) {
  let proximo = 0;
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const agora = Date.now();
    const espera = Math.max(0, proximo - agora);
    proximo = Math.max(agora, proximo) + intervaloMs;
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    return fn();
  };
}

export interface ServicosMapa {
  buscarEndereco(texto: string): Promise<Endereco[]>;
  buscarPois(lat: number, lon: number, raioM: number): Promise<PoiOsm[]>;
  buscarPredios(lat: number, lon: number, raioM: number): Promise<PredioOsm[]>;
  /** CEP (8 dígitos) → endereço (ViaCEP, grátis). Opcional: sem ele a criação pede o endereço. */
  buscarCep?(cep: string): Promise<EnderecoCep | null>;
}

/** Prédio do entorno: contorno em [lon, lat] (ordem GeoJSON), sem repetir o ponto final. */
export interface PredioOsm {
  osmId: string;
  alturaM: number;
  contorno: Array<[number, number]>;
}

export function consultaPredios(lat: number, lon: number, raioM: number): string {
  return `[out:json][timeout:50];way["building"](around:${raioM},${lat},${lon});out geom;`;
}

const ALTURA_ANDAR_M = 3;
const ALTURA_PADRAO_M = 9;
function alturaDoPredio(tags: Record<string, string>): number {
  const h = parseFloat(tags.height ?? '');
  if (Number.isFinite(h) && h > 0 && h < 1000) return h;
  const andares = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(andares) && andares > 0 && andares < 300) return andares * ALTURA_ANDAR_M;
  return ALTURA_PADRAO_M;
}
const sete = (n: number) => Math.round(n * 1e7) / 1e7;

/**
 * Prédios de uma resposta do Overpass. Aceita `out geom` (geometria na via) e o formato nós + vias
 * (arquivo baixado). Mais próximos do centro primeiro, até `limite`, dentro de `raioM`.
 */
export function interpretarPredios(json: unknown, centro: { lat: number; lon: number }, limite = 3000, raioM = Infinity): PredioOsm[] {
  const elementos = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elementos)) return [];
  const nos = new Map<number, { lat: number; lon: number }>();
  for (const e of elementos as Array<ElementoOverpass & { nodes?: unknown }>) {
    if (e?.type === 'node' && Number.isInteger(e.id) && Number.isFinite(e.lat) && Number.isFinite(e.lon)) nos.set(e.id!, { lat: e.lat!, lon: e.lon! });
  }
  const cosLat = Math.cos((centro.lat * Math.PI) / 180);
  const vistos = new Set<string>();
  const predios: Array<PredioOsm & { d: number }> = [];
  for (const e of elementos as Array<ElementoOverpass & { nodes?: unknown; geometry?: unknown }>) {
    if (e?.type !== 'way' || !Number.isInteger(e.id) || !e.tags?.building) continue;
    let pontos: Array<{ lat: number; lon: number } | undefined> = [];
    if (Array.isArray(e.geometry)) pontos = (e.geometry as Array<{ lat?: unknown; lon?: unknown }>).map((g) => (Number.isFinite(g?.lat) && Number.isFinite(g?.lon) ? { lat: g.lat as number, lon: g.lon as number } : undefined));
    else if (Array.isArray(e.nodes)) pontos = (e.nodes as unknown[]).map((id) => nos.get(id as number));
    if (pontos.some((p) => !p)) continue;
    const lista = pontos as Array<{ lat: number; lon: number }>;
    const fechado = lista.length > 1 && lista[0]!.lat === lista.at(-1)!.lat && lista[0]!.lon === lista.at(-1)!.lon;
    const contorno = (fechado ? lista.slice(0, -1) : lista).map((p): [number, number] => [sete(p.lon), sete(p.lat)]);
    if (contorno.length < 3) continue;
    const osmId = `way/${e.id}`;
    if (vistos.has(osmId)) continue;
    vistos.add(osmId);
    const cLat = contorno.reduce((a, p) => a + p[1], 0) / contorno.length;
    const cLon = contorno.reduce((a, p) => a + p[0], 0) / contorno.length;
    const d = Math.hypot((cLat - centro.lat) * 110_540, (cLon - centro.lon) * 111_320 * cosLat);
    if (d > raioM) continue;
    predios.push({ osmId, alturaM: alturaDoPredio(e.tags), contorno, d });
  }
  return predios
    .sort((a, b) => a.d - b.d)
    .slice(0, limite)
    .map(({ d: _d, ...p }) => p);
}

/** Serviços reais do OpenStreetMap. `userAgent` deve identificar a empresa (exigência do Nominatim). */
export function servicosMapaReais(userAgent: string): ServicosMapa {
  const fila = espacar(1100);
  return {
    buscarEndereco: (texto) =>
      fila(async () => {
        const q = new URLSearchParams({ q: texto, format: 'jsonv2', countrycodes: 'br', limit: '5', 'accept-language': 'pt-BR' });
        const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`Nominatim respondeu ${r.status}`);
        return interpretarNominatim(await r.json());
      }),
    buscarPois: async (lat, lon, raioM) => {
      const r = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'user-agent': userAgent, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ data: consultaOverpass(lat, lon, raioM) }),
        signal: AbortSignal.timeout(40_000),
      });
      if (!r.ok) throw new Error(`Overpass respondeu ${r.status}`);
      return interpretarOverpass(await r.json());
    },
    buscarPredios: async (lat, lon, raioM) => {
      const r = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'user-agent': userAgent, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ data: consultaPredios(lat, lon, raioM) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`Overpass respondeu ${r.status}`);
      return interpretarPredios(await r.json(), { lat, lon }, 3000, raioM);
    },
    buscarCep: async (cep) => {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(10_000) });
      if (r.status === 400) return null;
      if (!r.ok) throw new Error(`ViaCEP respondeu ${r.status}`);
      return interpretarViaCep(await r.json());
    },
  };
}

/**
 * Prédios lidos de um arquivo do Overpass já baixado (testes e demonstração sem internet).
 * Endereço e pontos de interesse continuam vindo do serviço `base`.
 */
export function comPrediosDeArquivo(base: ServicosMapa, caminho: string): ServicosMapa {
  let dados: Promise<unknown> | null = null;
  return {
    ...base,
    buscarPredios: async (lat, lon, raioM) => {
      dados ??= readFile(caminho, 'utf8').then((t) => JSON.parse(t) as unknown);
      return interpretarPredios(await dados, { lat, lon }, 3000, raioM);
    },
  };
}
