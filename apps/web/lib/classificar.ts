import type { TipoArquivo } from './tipos';

/**
 * Classificador da criação integrada (Plano 11a, item 2): decide, no navegador e sem custo, o que é cada arquivo
 * largado na tela. Regras por extensão e nome, EXIF (GPS e câmera) e as cores da imagem (planta é quase toda branca,
 * com traço escuro e quase sem cor). A pessoa sempre vê o palpite e troca com um toque antes de enviar.
 */
export const PAPEIS = ['foto', 'render', 'fachada', 'planta', 'documento', 'ifc', 'modelo', 'splat', 'captura', 'planilha', 'texto'] as const;
export type PapelArquivo = (typeof PAPEIS)[number];

export const ROTULO_PAPEL: Record<PapelArquivo, string> = {
  foto: 'Foto do imóvel',
  render: 'Imagem ilustrativa (render)',
  fachada: 'Fachada',
  planta: 'Planta baixa',
  documento: 'Documento (memorial, book)',
  ifc: 'Projeto BIM (IFC)',
  modelo: 'Modelo 3D (GLB)',
  splat: 'Splat 3D pronto',
  captura: 'Vídeo ou fotos para o 3D real',
  planilha: 'Planilha de unidades',
  texto: 'Texto da descrição',
};

/** Papéis que viram arquivo do empreendimento (planilha e texto são lidos aqui e não sobem). */
export const TIPO_DO_PAPEL: Record<Exclude<PapelArquivo, 'planilha' | 'texto'>, TipoArquivo> = {
  foto: 'imagem',
  render: 'imagem',
  fachada: 'imagem',
  planta: 'planta',
  documento: 'documento',
  ifc: 'ifc',
  modelo: 'modelo_3d',
  splat: 'splat',
  captura: 'captura',
};

/** Papéis aceitos para cada extensão (o que a API aceita guardar com aquele tipo). */
export function papeisPossiveis(nome: string): PapelArquivo[] {
  const ext = extensao(nome);
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext === '.webp' ? ['foto', 'render', 'fachada'] : ['foto', 'render', 'fachada', 'planta'];
  if (ext === '.pdf') return ['planta', 'documento'];
  if (ext === '.dxf' || ext === '.dwg') return ['planta'];
  if (ext === '.ifc') return ['ifc'];
  if (ext === '.glb') return ['modelo'];
  if (['.spz', '.ply', '.splat', '.sog'].includes(ext)) return ['splat'];
  if (['.mp4', '.mov', '.zip'].includes(ext)) return ['captura'];
  if (ext === '.csv' || ext === '.xlsx') return ['planilha'];
  if (ext === '.txt' || ext === '.md') return ['texto'];
  return [];
}

export const extensao = (nome: string): string => {
  const i = nome.lastIndexOf('.');
  return i < 0 ? '' : nome.slice(i).toLowerCase();
};

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const NOME_PLANTA = /(planta|layout|pavimento|pav[-_ ]?tipo|implanta|apto[-_ ]?tipo|\bpl[-_ ]?\d|floor[-_ ]?plan|tipo[-_ ]?\d)/;
const NOME_FACHADA = /(fachada|facade|frente|elevacao)/;
const NOME_RENDER = /(render|perspectiva|ilustra|3d|humanizad|maquete|vista[-_ ]aerea|aerea)/;

export interface Pistas {
  /** Câmera de verdade no EXIF (marca/modelo): é foto tirada, não render. */
  camera?: boolean;
  /** Imagem parece desenho técnico (cores; ver `pareceDesenho`). */
  desenho?: boolean;
}

/** Palpite do papel só pelo nome e pelo que foi lido do arquivo. */
export function classificar(nome: string, pistas: Pistas = {}): PapelArquivo | null {
  const possiveis = papeisPossiveis(nome);
  if (possiveis.length <= 1) return possiveis[0] ?? null;
  const n = semAcento(nome);
  if (extensao(nome) === '.pdf') return NOME_PLANTA.test(n) ? 'planta' : 'documento';
  if (NOME_PLANTA.test(n) && possiveis.includes('planta')) return 'planta';
  if (NOME_FACHADA.test(n)) return 'fachada';
  if (NOME_RENDER.test(n)) return 'render';
  if (pistas.camera) return 'foto';
  if (pistas.desenho && possiveis.includes('planta')) return 'planta';
  return 'foto';
}

export interface CoresImagem {
  /** Parte dos pixels quase brancos. */
  brancos: number;
  /** Parte dos pixels escuros (traço). */
  escuros: number;
  /** Saturação média (0 = cinza). */
  saturacao: number;
}

/** Estatística de cor de uma imagem reduzida (RGBA). */
export function coresDaImagem(rgba: ArrayLike<number>): CoresImagem {
  let brancos = 0;
  let escuros = 0;
  let sat = 0;
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 16) continue;
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luz = (max + min) / 2;
    if (min >= 225) brancos++;
    if (luz <= 90) escuros++;
    sat += max === 0 ? 0 : (max - min) / max;
    n++;
  }
  return n ? { brancos: brancos / n, escuros: escuros / n, saturacao: sat / n } : { brancos: 0, escuros: 0, saturacao: 0 };
}

/** Planta e desenho técnico: fundo branco dominante, pouco traço escuro e quase sem cor. Foto e render não passam. */
export const pareceDesenho = (c: CoresImagem): boolean => c.brancos >= 0.5 && c.escuros <= 0.3 && c.saturacao <= 0.15;

export interface Exif {
  gps: { lat: number; lon: number } | null;
  /** Para onde a câmera olhava (graus a partir do norte), quando o celular grava a bússola. */
  rumo: number | null;
  camera: boolean;
}

/**
 * GPS e câmera do EXIF de um JPEG (só o começo do arquivo: o EXIF fica no segmento APP1, nos primeiros KB).
 * Nunca lança: arquivo sem EXIF ou corrompido volta vazio.
 */
export function lerExif(bytes: Uint8Array): Exif {
  const vazio: Exif = { gps: null, rumo: null, camera: false };
  try {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return vazio;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p] !== 0xff) return vazio;
      const marca = bytes[p + 1]!;
      const tam = dv.getUint16(p + 2);
      if (marca === 0xda || marca === 0xd9) return vazio; // começou a imagem: sem EXIF
      if (marca === 0xe1 && String.fromCharCode(...bytes.subarray(p + 4, p + 8)) === 'Exif') return lerTiff(dv, p + 10);
      p += 2 + tam;
    }
  } catch {
    return vazio;
  }
  return vazio;
}

function lerTiff(dv: DataView, base: number): Exif {
  const le = dv.getUint16(base) === 0x4949;
  const u16 = (o: number) => dv.getUint16(base + o, le);
  const u32 = (o: number) => dv.getUint32(base + o, le);
  const entradas = (ifd: number) => {
    const n = u16(ifd);
    const m = new Map<number, { tipo: number; qtd: number; valor: number }>();
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      m.set(u16(e), { tipo: u16(e + 2), qtd: u32(e + 4), valor: e + 8 });
    }
    return m;
  };
  const ifd0 = entradas(u32(4));
  const camera = ifd0.has(0x010f) || ifd0.has(0x0110);
  const ptrGps = ifd0.get(0x8825);
  if (!ptrGps) return { gps: null, rumo: null, camera };
  const g = entradas(u32(ptrGps.valor));
  const ref = (tag: number) => {
    const e = g.get(tag);
    return e ? String.fromCharCode(dv.getUint8(base + e.valor)) : '';
  };
  const graus = (tag: number) => {
    const e = g.get(tag);
    if (!e || e.tipo !== 5 || e.qtd !== 3) return null;
    const o = u32(e.valor);
    const r = (k: number) => {
      const den = u32(o + k * 8 + 4);
      return den ? u32(o + k * 8) / den : 0;
    };
    return r(0) + r(1) / 60 + r(2) / 3600;
  };
  const lat = graus(2);
  const lon = graus(4);
  if (lat === null || lon === null || (lat === 0 && lon === 0)) return { gps: null, rumo: null, camera };
  // GPSImgDirection (tag 17, um racional): norte verdadeiro ou magnético, tanto faz para pôr um quadro no 3D
  const d = g.get(0x11);
  let rumo: number | null = null;
  if (d && d.tipo === 5 && d.qtd === 1) {
    const o = u32(d.valor);
    const den = u32(o + 4);
    if (den) rumo = ((u32(o) / den) % 360 + 360) % 360;
  }
  return { gps: { lat: ref(1) === 'S' ? -lat : lat, lon: ref(3) === 'W' ? -lon : lon }, rumo, camera };
}
