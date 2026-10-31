import { strFromU8, unzipSync } from 'fflate';

/**
 * Leitor mínimo de .xlsx (Office Open XML) para a importação de unidades: só a 1ª aba, só valores.
 * Feito aqui para não depender do pacote `xlsx` do npm, que está desatualizado e tem falhas conhecidas.
 */
const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e.startsWith('#x') ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : ENTIDADES[e]!,
  );
/** Junta todos os <t> (texto simples ou rico, com vários trechos). */
const textos = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodificar(m[1]!)).join('');
const atributo = (atrs: string, nome: string) => atrs.match(new RegExp(`\\b${nome}="([^"]*)"`))?.[1];

function coluna(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function lerXlsx(bytes: Uint8Array): string[][] {
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(bytes);
  } catch {
    throw new Error('O arquivo não é uma planilha .xlsx válida.');
  }
  const ler = (nome: string) => (arquivos[nome] ? strFromU8(arquivos[nome]) : null);
  const livro = ler('xl/workbook.xml');
  if (!livro) throw new Error('O arquivo não é uma planilha .xlsx válida.');

  // 1ª aba → arquivo da aba pelas relações do livro
  const rid = livro.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const relacoes = ler('xl/_rels/workbook.xml.rels') ?? '';
  const alvo = [...relacoes.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]!).find((a) => atributo(a, 'Id') === rid);
  const caminho = alvo ? atributo(alvo, 'Target') ?? '' : 'worksheets/sheet1.xml';
  const aba = ler(caminho.startsWith('/') ? caminho.slice(1) : `xl/${caminho}`);
  if (!aba) throw new Error('A planilha não tem abas.');

  const compartilhadas = [...(ler('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]!));
  const tabela: string[][] = [];
  let proximaLinha = 0;
  for (const mLinha of aba.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const numero = Number(atributo(mLinha[1]!, 'r') ?? proximaLinha + 1) - 1;
    proximaLinha = numero + 1;
    const linha: string[] = [];
    let proximaColuna = 0;
    for (const mCel of (mLinha[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atrs = mCel[1]!;
      const ref = atributo(atrs, 'r');
      const col = ref ? coluna(ref) : proximaColuna;
      proximaColuna = col + 1;
      const interno = mCel[2] ?? '';
      const tipo = atributo(atrs, 't');
      const v = interno.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let valor = '';
      if (tipo === 's') valor = compartilhadas[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = textos(interno);
      else if (v !== undefined) valor = decodificar(v);
      while (linha.length < col) linha.push('');
      linha[col] = valor;
    }
    while (tabela.length < numero) tabela.push([]);
    tabela[numero] = linha;
  }
  return tabela;
}

/** CSV com `;` (o mesmo formato que a importação já aceita), com aspas só quando precisa. */
export const tabelaParaCsv = (tabela: string[][]): string =>
  tabela
    .filter((l) => l.length > 0)
    .map((l) => l.map((c) => (/[;"\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';'))
    .join('\n');
