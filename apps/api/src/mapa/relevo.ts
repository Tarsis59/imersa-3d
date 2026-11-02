import { inflateSync } from 'node:zlib';

/**
 * Relevo em volta do empreendimento (Plano 11b, item 7): Terrain Tiles da AWS (dados abertos, formato "terrarium":
 * altura = R·256 + G + B/256 − 32768 metros), lidos no servidor (o bucket não libera CORS para o navegador).
 * Vira uma grade de alturas relativas ao ponto do empreendimento, que o 3D usa para o chão, as ruas e os vizinhos.
 */

export const ZOOM_RELEVO = 14;
/** Pontos por lado da grade (65 × 65 = 4225 alturas, ~16 m entre pontos num raio de 500 m). */
export const PONTOS_RELEVO = 65;

export interface Relevo {
  /** Centro da grade (o ponto do empreendimento quando foi lida). */
  centro: { lat: number; lon: number };
  raioM: number;
  n: number;
  /** Linha a linha do norte para o sul (z local crescente), cada linha do oeste para o leste; metros relativos ao centro. */
  alturas: number[];
  /** Altitude do centro acima do mar (só informativo). */
  altitudeM: number;
}

export interface Png {
  largura: number;
  altura: number;
  canais: number;
  dados: Uint8Array;
}

/** PNG de 8 bits por canal (RGB ou RGBA), sem entrelaçamento: o suficiente para os blocos de relevo. */
export function decodificarPng(buf: Uint8Array): Png {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) throw new Error('não é PNG');
  let p = 8;
  let largura = 0;
  let altura = 0;
  let canais = 0;
  const idat: Buffer[] = [];
  while (p + 8 <= b.length) {
    const tam = b.readUInt32BE(p);
    const tipo = b.toString('latin1', p + 4, p + 8);
    const corpo = b.subarray(p + 8, p + 8 + tam);
    if (tipo === 'IHDR') {
      largura = corpo.readUInt32BE(0);
      altura = corpo.readUInt32BE(4);
      const bits = corpo[8]!;
      const cor = corpo[9]!;
      if (bits !== 8 || corpo[12] !== 0 || (cor !== 2 && cor !== 6)) throw new Error('PNG não suportado');
      canais = cor === 2 ? 3 : 4;
    } else if (tipo === 'IDAT') idat.push(corpo);
    else if (tipo === 'IEND') break;
    p += 12 + tam;
  }
  if (!largura || !altura || !idat.length) throw new Error('PNG incompleto');
  const cru = inflateSync(Buffer.concat(idat));
  const linha = largura * canais;
  const dados = new Uint8Array(altura * linha);
  for (let y = 0; y < altura; y++) {
    const f = cru[y * (linha + 1)]!;
    const ent = y * (linha + 1) + 1;
    const sai = y * linha;
    for (let x = 0; x < linha; x++) {
      const v = cru[ent + x]!;
      const a = x >= canais ? dados[sai + x - canais]! : 0;
      const c = y > 0 ? dados[sai - linha + x]! : 0;
      const ac = y > 0 && x >= canais ? dados[sai - linha + x - canais]! : 0;
      let r: number;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + c;
      else if (f === 3) r = v + ((a + c) >> 1);
      else if (f === 4) {
        const pp = a + c - ac;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - c);
        const pc = Math.abs(pp - ac);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? c : ac);
      } else throw new Error('filtro PNG inválido');
      dados[sai + x] = r & 0xff;
    }
  }
  return { largura, altura, canais, dados };
}

/** Coordenada do mapa (Web Mercator) em "blocos" fracionários no zoom z. */
export function blocoDe(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

const M_LAT = 110_540;
const M_LON = 111_320;

/** Ponto a (x leste, z sul) metros do centro → lat/lon (mesma projeção local do 3D). */
export function localParaLatLon(centro: { lat: number; lon: number }, x: number, z: number): { lat: number; lon: number } {
  return { lat: centro.lat - z / M_LAT, lon: centro.lon + x / (M_LON * Math.cos((centro.lat * Math.PI) / 180)) };
}

export type BuscarBloco = (z: number, x: number, y: number) => Promise<Uint8Array>;

/** Lê os blocos que cobrem o raio e devolve a grade de alturas relativas ao centro. */
export async function lerRelevo(centro: { lat: number; lon: number }, raioM: number, buscar: BuscarBloco, n = PONTOS_RELEVO, z = ZOOM_RELEVO): Promise<Relevo> {
  const blocos = new Map<string, Promise<Png>>();
  const bloco = (bx: number, by: number) => {
    const k = `${bx}/${by}`;
    let b = blocos.get(k);
    if (!b) {
      b = buscar(z, bx, by).then(decodificarPng);
      blocos.set(k, b);
    }
    return b;
  };
  const alturaEm = async (lat: number, lon: number) => {
    const t = blocoDe(lat, lon, z);
    const bx = Math.floor(t.x);
    const by = Math.floor(t.y);
    const png = await bloco(bx, by);
    // vizinho mais perto dentro do bloco (16 m de grade; o bloco tem ~9 m por pixel no zoom 14)
    const px = Math.min(png.largura - 1, Math.floor((t.x - bx) * png.largura));
    const py = Math.min(png.altura - 1, Math.floor((t.y - by) * png.altura));
    const i = (py * png.largura + px) * png.canais;
    return png.dados[i]! * 256 + png.dados[i + 1]! + png.dados[i + 2]! / 256 - 32768;
  };
  const absolutas: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = localParaLatLon(centro, -raioM + (2 * raioM * i) / (n - 1), -raioM + (2 * raioM * j) / (n - 1));
      absolutas.push(await alturaEm(p.lat, p.lon));
    }
  }
  const base = await alturaEm(centro.lat, centro.lon);
  return { centro, raioM, n, alturas: absolutas.map((a) => Math.round((a - base) * 10) / 10), altitudeM: Math.round(base * 10) / 10 };
}
