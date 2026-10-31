export const TIPOS_ARQUIVO = ['modelo_3d', 'splat', 'ifc', 'planta', 'imagem', 'documento'] as const;
export type TipoArquivo = (typeof TIPOS_ARQUIVO)[number];

const MB = 1024 * 1024;

export const REGRAS: Record<TipoArquivo, { extensoes: readonly string[]; maxBytes: number }> = {
  modelo_3d: { extensoes: ['.glb'], maxBytes: 500 * MB },
  splat: { extensoes: ['.spz', '.ply', '.splat', '.sog'], maxBytes: 1024 * MB },
  ifc: { extensoes: ['.ifc'], maxBytes: 300 * MB },
  planta: { extensoes: ['.pdf', '.png', '.jpg', '.jpeg', '.dwg'], maxBytes: 100 * MB },
  imagem: { extensoes: ['.png', '.jpg', '.jpeg', '.webp'], maxBytes: 30 * MB },
  documento: { extensoes: ['.pdf'], maxBytes: 50 * MB },
};

/** Bytes do começo do arquivo necessários para conferir a assinatura. */
export const BYTES_INICIO = 16;

type Conferidor = (inicio: Buffer, tamanho: number) => boolean;
const comeca =
  (assinatura: string | number[]): Conferidor =>
  (b) => {
    const a = typeof assinatura === 'string' ? Buffer.from(assinatura, 'latin1') : Buffer.from(assinatura);
    return b.length >= a.length && b.subarray(0, a.length).equals(a);
  };

/** Assinatura binária ("número mágico") de cada extensão: o arquivo precisa ser o que diz ser. */
const MAGIA: Record<string, Conferidor> = {
  '.glb': comeca('glTF'),
  '.spz': comeca([0x1f, 0x8b]),
  '.ply': (b) => /^ply\r?\n/.test(b.subarray(0, 5).toString('latin1')),
  '.sog': comeca([0x50, 0x4b, 0x03, 0x04]),
  '.splat': (_b, tamanho) => tamanho > 0 && tamanho % 32 === 0, // sem cabeçalho: 32 bytes por ponto
  '.ifc': comeca('ISO-10303-21'),
  '.pdf': comeca('%PDF-'),
  '.png': comeca([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  '.jpg': comeca([0xff, 0xd8, 0xff]),
  '.jpeg': comeca([0xff, 0xd8, 0xff]),
  '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  '.dwg': comeca('AC10'),
};

const CONTEUDO: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export const extensao = (nome: string): string => {
  const i = nome.lastIndexOf('.');
  return i < 0 ? '' : nome.slice(i).toLowerCase();
};

export const tipoDeConteudo = (nome: string): string => CONTEUDO[extensao(nome)] ?? 'application/octet-stream';

export function validarDeclaracao(tipo: TipoArquivo, nome: string, tamanho: number): string | null {
  const regra = REGRAS[tipo];
  if (!regra.extensoes.includes(extensao(nome))) return `extensão não aceita para ${tipo}: use ${regra.extensoes.join(', ')}`;
  if (tamanho > regra.maxBytes) return `arquivo maior que o limite de ${Math.round(regra.maxBytes / MB)} MB`;
  return null;
}

export function conferirConteudo(nome: string, inicio: Buffer, tamanho: number): string | null {
  const conferir = MAGIA[extensao(nome)];
  if (!conferir) return 'extensão sem verificação de conteúdo';
  return conferir(inicio, tamanho) ? null : 'o conteúdo não corresponde ao tipo do arquivo';
}

/** Só letras, números, ponto, hífen e sublinhado; até 100 caracteres preservando a extensão. */
export function nomeSeguro(nome: string): string {
  const limpo = nome.replace(/[^A-Za-z0-9._-]/g, '_');
  if (limpo.length <= 100) return limpo;
  const ext = extensao(limpo);
  return limpo.slice(0, 100 - ext.length) + ext;
}
