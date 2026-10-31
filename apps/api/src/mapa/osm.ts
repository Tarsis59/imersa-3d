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
  };
}
