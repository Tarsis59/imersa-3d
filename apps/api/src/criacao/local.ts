import type { Descricao } from './texto';

export interface Ponto {
  lat: number;
  lon: number;
}

export type FonteLocal = 'escolhido' | 'gps' | 'endereco' | 'cep' | 'cidade';

export interface LocalAchado extends Ponto {
  fonte: FonteLocal;
  rotulo: string;
}

/** Fotos tiradas no imóvel: mais longe que isso da mediana é foto de outro lugar (ou GPS ruim) e fica de fora. */
const DISPERSAO_MAX_M = 2000;

export function distanciaM(a: Ponto, b: Ponto): number {
  const r = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Lugar pelas fotos (GPS do EXIF): a mediana resiste a uma ou outra foto de outro lugar. `null` quando nenhuma foto
 * tem GPS, ou quando as que têm não concordam (metade ou mais longe da mediana).
 */
export function centroDosGps(pontos: readonly Ponto[]): Ponto | null {
  const validos = pontos.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0));
  if (!validos.length) return null;
  const m = { lat: mediana(validos.map((p) => p.lat)), lon: mediana(validos.map((p) => p.lon)) };
  const perto = validos.filter((p) => distanciaM(p, m) <= DISPERSAO_MAX_M);
  if (perto.length * 2 <= validos.length) return null;
  return { lat: mediana(perto.map((p) => p.lat)), lon: mediana(perto.map((p) => p.lon)) };
}

/** Só o Brasil (o produto e o Nominatim com `countrycodes=br`). */
export const noBrasil = (p: Ponto): boolean => p.lat > -34.5 && p.lat < 5.6 && p.lon > -74.5 && p.lon < -28.5;

/** Consultas ao geocodificador, da mais precisa para a mais larga. */
export function consultasDoTexto(d: Pick<Descricao, 'endereco' | 'bairro' | 'cidade' | 'uf'>): Array<{ consulta: string; fonte: FonteLocal }> {
  const cidade = [d.cidade, d.uf].filter(Boolean).join(' - ');
  const saida: Array<{ consulta: string; fonte: FonteLocal }> = [];
  if (d.endereco) {
    if (d.bairro && cidade) saida.push({ consulta: `${d.endereco}, ${d.bairro}, ${cidade}`, fonte: 'endereco' });
    if (cidade) saida.push({ consulta: `${d.endereco}, ${cidade}`, fonte: 'endereco' });
    else saida.push({ consulta: d.endereco, fonte: 'endereco' });
  }
  return saida;
}

/** CEP com 8 dígitos ("80240-000" ou "80240000") → "80240000"; senão null. */
export function limparCep(cep: string | null | undefined): string | null {
  const d = (cep ?? '').replace(/\D/g, '');
  return d.length === 8 && !/^0{8}$/.test(d) ? d : null;
}

export interface EnderecoCep {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
}

/** Resposta do ViaCEP (`{"erro": true}` quando o CEP não existe). */
export function interpretarViaCep(json: unknown): EnderecoCep | null {
  const j = json as Partial<EnderecoCep> & { erro?: unknown };
  if (!j || typeof j !== 'object' || j.erro || typeof j.localidade !== 'string' || typeof j.uf !== 'string') return null;
  return { logradouro: String(j.logradouro ?? ''), bairro: String(j.bairro ?? ''), localidade: j.localidade, uf: j.uf };
}
