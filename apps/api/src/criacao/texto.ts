import { lerNumeroBr } from '../dominio/numeros';

/**
 * Leitura do texto livre da criação (Plano 11a, item 3): "Residencial Aurora, 12 andares, 4 por andar, 2 e 3 quartos,
 * piscina e academia, na Rua das Flores, 120, Curitiba/PR" vira dados. Só regras (grátis, sem IA): o que não ficar
 * claro volta em `avisos` e a pessoa confirma na tela antes de qualquer coisa ser gravada.
 */

export const CATEGORIAS_LAZER = ['piscina', 'academia', 'salao_festas', 'churrasqueira', 'playground', 'quadra', 'espaco_gourmet', 'brinquedoteca', 'coworking', 'pet', 'jardim', 'outro'] as const;
export type CategoriaLazer = (typeof CATEGORIAS_LAZER)[number];

export interface TipologiaLida {
  nome: string;
  quartos: number;
  suites: number;
  /** null = o texto não disse (o plano usa a área típica e avisa). */
  areaM2: number | null;
}

export interface LazerLido {
  categoria: CategoriaLazer;
  nome: string;
}

export interface Descricao {
  nome: string | null;
  /** Andares acima do térreo (pavimentos tipo). */
  andares: number | null;
  unidadesPorAndar: number | null;
  totalUnidades: number | null;
  subsolos: number | null;
  torres: number | null;
  tipologias: TipologiaLida[];
  vagas: number | null;
  lazer: LazerLido[];
  /** "Rua das Flores, 120" (sem cidade). */
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  /** Só informativo: preço de venda vem sempre da planilha ou da gestão, nunca do texto. */
  precoAPartirDe: number | null;
  avisos: string[];
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
const ESTADOS: Record<string, (typeof UFS)[number]> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'mato grosso do sul': 'MS', 'mato grosso': 'MT', 'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE',
  piaui: 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC',
  'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};

/** Minúsculas, sem acento, espaços simples (o comprimento muda pouco; as buscas de nome usam o texto original). */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const UNIDADES: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
};
const DEZENAS: Record<string, number> = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const CENTENAS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500,
  quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

/** "vinte e dois andares" → "22 andares"; "cento e vinte unidades" → "120 unidades". "2 e 3" fica como está. Texto já normalizado. */
export function numerosPorExtenso(n: string): string {
  const palavras = n.split(' ');
  const saida: string[] = [];
  const valor = (p: string) => UNIDADES[p] ?? DEZENAS[p] ?? CENTENAS[p];
  const limpa = (p: string) => p.replace(/[^a-z]/g, '');
  for (let i = 0; i < palavras.length; i++) {
    const p = palavras[i]!;
    const base = limpa(p);
    if (valor(base) === undefined || base === '' || p.replace(/[,.;:!?)]$/, '') !== base) {
      saida.push(p);
      continue;
    }
    // junta "vinte e dois", "cento e vinte e cinco" (cada parte menor que a anterior)
    let total = valor(base)!;
    let ultimo = total;
    let j = i;
    while (palavras[j + 1] === 'e' && palavras[j + 2] !== undefined) {
      const prox = limpa(palavras[j + 2]!);
      const v = valor(prox);
      if (v === undefined || palavras[j + 2]!.replace(/[,.;:!?)]$/, '') !== prox) break;
      const cabe = (ultimo >= 100 && v < 100) || (ultimo >= 20 && ultimo < 100 && v < 10 && v > 0);
      if (!cabe) break;
      total += v;
      ultimo = v;
      j += 2;
    }
    // pontuação no fim da última palavra fica
    const fim = palavras[j]!.match(/[,.;:!?)]$/)?.[0] ?? '';
    saida.push(String(total) + fim);
    i = j;
  }
  return saida.join(' ');
}

const AREA_TIPICA: Record<number, number> = { 0: 32, 1: 45, 2: 62, 3: 85, 4: 120 };
export const areaTipica = (quartos: number): number => AREA_TIPICA[Math.min(4, quartos)] ?? 120;

const LISTA = String.raw`(\d+(?:\s*(?:,|e|ou|a|ate)\s*\d+)*)`;

/** "2 e 3" → [2, 3]; "2 a 4" → [2, 3, 4]; "1, 2 ou 3" → [1, 2, 3]. */
function lerLista(s: string): number[] {
  const faixa = s.match(/^(\d+)\s*(?:a|ate)\s*(\d+)$/);
  if (faixa) {
    const a = Number(faixa[1]);
    const b = Number(faixa[2]);
    if (b >= a && b - a <= 6) return Array.from({ length: b - a + 1 }, (_, k) => a + k);
  }
  return [...new Set((s.match(/\d+/g) ?? []).map(Number))];
}

function lerDinheiro(numero: string, escala: string | undefined): number | null {
  const v = lerNumeroBr(numero);
  if (v === null || v === 'invalido') return null;
  const e = escala ? (/^mil$/.test(escala) ? 1e3 : 1e6) : 1;
  const total = Math.round(v * e);
  return total >= 10_000 && total < 1e10 ? total : null;
}

const PALAVRAS_LAZER: Array<{ re: RegExp; categoria: CategoriaLazer; nome: string }> = [
  { re: /\bpiscinas?\b/, categoria: 'piscina', nome: 'Piscina' },
  { re: /\b(academia|fitness|sala de ginastica|espaco fitness)\b/, categoria: 'academia', nome: 'Academia' },
  { re: /\bsal(ao|oes) de festas?\b/, categoria: 'salao_festas', nome: 'Salão de festas' },
  { re: /\bchurrasqueiras?\b/, categoria: 'churrasqueira', nome: 'Churrasqueira' },
  { re: /\b(espaco )?gourmet\b/, categoria: 'espaco_gourmet', nome: 'Espaço gourmet' },
  { re: /\b(playground|parquinho)\b/, categoria: 'playground', nome: 'Playground' },
  { re: /\bbrinquedoteca\b/, categoria: 'brinquedoteca', nome: 'Brinquedoteca' },
  { re: /\b(quadras?( poliesportiva| de tenis| de beach tennis)?|beach tennis)\b/, categoria: 'quadra', nome: 'Quadra' },
  { re: /\bco-?working\b/, categoria: 'coworking', nome: 'Coworking' },
  { re: /\b(pet ?place|espaco pet|pet care)\b/, categoria: 'pet', nome: 'Espaço pet' },
  { re: /\b(sauna)\b/, categoria: 'outro', nome: 'Sauna' },
  { re: /\b(sal(ao|oes) de jogos)\b/, categoria: 'outro', nome: 'Salão de jogos' },
  { re: /\b(cinema|espaco cinema|home theater)\b/, categoria: 'outro', nome: 'Cinema' },
  { re: /\b(spa)\b/, categoria: 'outro', nome: 'Spa' },
  { re: /\b(rooftop|solarium|deck molhado)\b/, categoria: 'outro', nome: 'Rooftop' },
  { re: /\b(lavanderia)\b/, categoria: 'outro', nome: 'Lavanderia' },
  { re: /\b(bicicletario)\b/, categoria: 'outro', nome: 'Bicicletário' },
];

const TIPOS_RUA = String.raw`(?:[Rr]ua|R\.|[Aa]venida|[Aa]v\.?|[Aa]lameda|Al\.|[Tt]ravessa|Tv\.|[Ee]strada|[Rr]odovia|Rod\.|[Pp]raça|[Ll]argo|[Ss]ervidão)`;
const PALAVRA_NOME = String.raw`(?:d[aeo]s?|e|[A-ZÀ-Ý0-9][\wÀ-ÿ'’.-]*)`;

function lerEndereco(texto: string): { endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null } {
  let endereco: string | null = null;
  let resto = '';
  const m = texto.match(new RegExp(String.raw`\b${TIPOS_RUA}\s+${PALAVRA_NOME}(?:\s+${PALAVRA_NOME})*(?:,?\s*(?:n[º°o.]?\s*)?\d{1,6}[A-Za-z]?\b)?`, 'u'));
  if (m) {
    endereco = m[0].replace(/\s+/g, ' ').replace(/[\s,]+$/, '').replace(/\s+(e|d[aeo]s?)$/i, '');
    resto = texto.slice(m.index! + m[0].length);
  }
  let cidade: string | null = null;
  let uf: string | null = null;
  const alvo = endereco ? resto : texto;
  const cUf = alvo.match(/([A-ZÀ-Ý][\wÀ-ÿ'’]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\wÀ-ÿ'’]+)*)\s*(?:-|\/|,|–|\()\s*([A-Z]{2})\b/u);
  if (cUf && (UFS as readonly string[]).includes(cUf[2]!)) {
    cidade = cUf[1]!;
    uf = cUf[2]!;
  } else {
    // "em Curitiba, no Paraná" / "em Joinville (Santa Catarina)"
    const est = normalizar(alvo).match(new RegExp(`\\b(${Object.keys(ESTADOS).sort((a, b) => b.length - a.length).join('|')})\\b`));
    const emCidade = alvo.match(/\b(?:em|na cidade de)\s+([A-ZÀ-Ý][\wÀ-ÿ'’]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\wÀ-ÿ'’]+)*)/u);
    if (emCidade) cidade = emCidade[1]!;
    if (est) uf = ESTADOS[est[1]!]!;
    if (cidade && uf && normalizar(cidade) === Object.entries(ESTADOS).find(([, v]) => v === uf)?.[0]) cidade = null;
  }
  // bairro: o pedaço entre o endereço e a cidade ("Rua X, 120, Batel, Curitiba/PR" ou "... - Batel, ...")
  let bairro: string | null = null;
  if (endereco && cidade) {
    const meio = resto.slice(0, resto.indexOf(cidade)).replace(/^[\s,–-]+|[\s,–-]+$/g, '');
    const b = meio.match(/^(?:bairro\s+)?([A-ZÀ-Ý][\wÀ-ÿ'’]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\wÀ-ÿ'’]+)*)$/u);
    if (b) bairro = b[1]!;
  }
  return { endereco, bairro, cidade, uf };
}

function lerNome(texto: string): string | null {
  const aspas = texto.match(/["“«]([^"”»]{3,80})["”»]/u);
  if (aspas) return aspas[1]!.trim();
  const m = texto.match(
    new RegExp(String.raw`\b(Residencial|Edifício|Edificio|Ed\.|Condomínio|Condominio|Spazio|Solar|Living)(?:\s+(?:d[aeo]s?|[A-ZÀ-Ý0-9][\wÀ-ÿ'’-]*))+`, 'u'),
  );
  if (!m) return null;
  return m[0].replace(/(\s+(e|d[aeo]s?))+$/i, '').trim().slice(0, 120);
}

/** Lê a descrição livre. Nunca lança: o que não deu para ler fica `null` e vira aviso. */
export function interpretarDescricao(texto: string): Descricao {
  const original = texto.slice(0, 4000);
  const n = numerosPorExtenso(normalizar(original));
  const avisos: string[] = [];
  const um = (re: RegExp) => {
    const m = n.match(re);
    return m ? Number(m[1]) : null;
  };

  // andares: "12 andares", "12 pavimentos tipo", "terreo + 10" (o "por andar" não conta)
  let andares = um(/\b(\d+)\s*(?:andares|pavimentos|pisos)\b/);
  andares ??= um(/\bterreo\s*(?:\+|mais)\s*(\d+)\b/);
  andares ??= um(/\b(\d+)\s*andar\b/);
  if (andares !== null && (andares < 1 || andares > 200)) {
    avisos.push(`Número de andares fora do comum (${andares}): confira.`);
    andares = null;
  }
  const unidadesPorAndar = um(/\b(\d+)\s*(?:apartamentos|apartamento|aptos?|apts?|unidades|unidade)?\s*(?:por|em cada)\s*(?:andar|pavimento|piso)\b/);
  const totalUnidades = um(/\b(\d+)\s*(?:apartamentos|aptos|apts|unidades)\b(?!\s*(?:por|em cada))/);
  const subsolos = um(/\b(\d+)\s*subsolos?\b/) ?? (/\bsubsolo\b/.test(n) ? 1 : null);
  const torres = um(/\b(\d+)\s*(?:torres|blocos)\b/) ?? (/\b(torre|bloco)\s+unic[ao]\b/.test(n) ? 1 : null);
  const vagas = um(/\b(\d+)\s*vagas?\b/);

  // tipologias: "2 e 3 quartos", "2 dormitorios", "studio", "3 suites"
  const tipologias: TipologiaLida[] = [];
  const vistos = new Set<number>();
  for (const m of n.matchAll(new RegExp(String.raw`\b${LISTA}\s*(?:quartos?|dormitorios?|dorms?\.?)`, 'g'))) {
    const lista = lerLista(m[1]!);
    const depois = n.slice(m.index! + m[0].length, m.index! + m[0].length + 45);
    const suites = depois.match(/^\s*(?:\(|,)?\s*(?:sendo\s*|com\s*|e\s*)?(\d+)\s*suites?/)?.[1];
    const comSuite = /^\s*(?:\(|,)?\s*(?:sendo\s*1\s*|com\s*(?:1\s*)?|e\s*1\s*)suite\b/.test(depois);
    for (const q of lista) {
      if (q > 10 || vistos.has(q)) continue;
      vistos.add(q);
      tipologias.push({ nome: '', quartos: q, suites: Math.min(q, suites !== undefined ? Number(suites) : comSuite ? 1 : 0), areaM2: null });
    }
  }
  for (const m of n.matchAll(new RegExp(String.raw`\b${LISTA}\s*suites\b`, 'g'))) {
    // "3 e 4 suites" sozinho (sem "quartos" logo antes) são tipologias de 3 e 4 quartos, todos suítes
    if (/(quartos?|dormitorios?)[^.]{0,20}$/.test(n.slice(Math.max(0, m.index! - 30), m.index!))) continue;
    for (const q of lerLista(m[1]!)) {
      if (q > 0 && q <= 10 && !vistos.has(q)) {
        vistos.add(q);
        tipologias.push({ nome: '', quartos: q, suites: q, areaM2: null });
      }
    }
  }
  if (/\b(studios?|estudios?|kitnets?|lofts?|kitinetes?)\b/.test(n) && !vistos.has(0)) tipologias.push({ nome: '', quartos: 0, suites: 0, areaM2: null });
  tipologias.sort((a, b) => a.quartos - b.quartos);

  // áreas: "65 m2", "de 65 a 90 m²", "65 e 90 metros quadrados"
  const areas: number[] = [];
  for (const m of n.matchAll(/\b(\d+(?:[.,]\d+)?(?:\s*(?:,|e|a|ate)\s*\d+(?:[.,]\d+)?)*)\s*(?:m2|m²|metros quadrados)/g)) {
    for (const x of m[1]!.split(/\s*(?:,(?!\d)|\be\b|\ba\b|\bate\b)\s*/)) {
      const v = lerNumeroBr(x.trim());
      if (typeof v === 'number' && v >= 15 && v <= 2000) areas.push(v);
    }
  }
  const ordenadas = [...new Set(areas)].sort((a, b) => a - b);
  if (tipologias.length && ordenadas.length) {
    if (ordenadas.length === tipologias.length) tipologias.forEach((t, i) => (t.areaM2 = ordenadas[i]!));
    else if (ordenadas.length === 2 && tipologias.length > 2) {
      const [a, b] = ordenadas as [number, number];
      tipologias.forEach((t, i) => (t.areaM2 = Math.round(a + ((b - a) * i) / (tipologias.length - 1))));
    } else if (ordenadas.length === 1 && tipologias.length === 1) tipologias[0]!.areaM2 = ordenadas[0]!;
    else avisos.push('Não deu para ligar cada área a uma tipologia: confira as áreas.');
  }
  for (const t of tipologias) {
    t.nome = t.quartos === 0 ? 'Studio' : `${t.quartos} quarto${t.quartos > 1 ? 's' : ''}${t.suites ? ` (${t.suites === t.quartos ? `${t.suites === 1 ? 'suíte' : 'todos suítes'}` : `${t.suites} suíte${t.suites > 1 ? 's' : ''}`})` : ''}`;
  }

  const lazer: LazerLido[] = [];
  for (const p of PALAVRAS_LAZER) {
    if (p.re.test(n) && !lazer.some((l) => l.nome === p.nome)) lazer.push({ categoria: p.categoria, nome: p.nome });
  }
  // "jardim"/"praça" minúsculo é lazer; "Jardim das Flores" é nome de bairro ou do prédio
  if (/(^|[^\wÀ-ÿ])(jardim|jardins|praça|praca|bosque)\b/u.test(original.replace(/\b(Jardim|Jardins|Praça|Bosque)\b/gu, ''))) lazer.push({ categoria: 'jardim', nome: 'Jardim' });
  // ordem de quem leu: a do texto
  lazer.sort((a, b) => posicao(n, a) - posicao(n, b));

  const cep = original.match(/\b(\d{5})-?(\d{3})\b/);
  const local = lerEndereco(original);

  let preco: number | null = null;
  for (const p of n.matchAll(/(?:a partir de|desde|por|r\$)\s*(?:r\$\s*)?(\d[\d.,]*)\s*(mil|milhao|milhoes|mi)?\b/g)) {
    preco = lerDinheiro(p[1]!.replace(/[.,]$/, ''), p[2]);
    if (preco !== null) break;
  }

  if (andares === null && totalUnidades === null) avisos.push('Não achei quantos andares o prédio tem.');
  if (!tipologias.length) avisos.push('Não achei as tipologias (quantos quartos).');
  if (andares !== null && unidadesPorAndar !== null && totalUnidades !== null && andares * unidadesPorAndar * (torres ?? 1) !== totalUnidades) {
    avisos.push(`${andares} andares × ${unidadesPorAndar} por andar${torres && torres > 1 ? ` × ${torres} torres` : ''} não dá ${totalUnidades} unidades: confira.`);
  }

  return {
    nome: lerNome(original),
    andares,
    unidadesPorAndar,
    totalUnidades,
    subsolos,
    torres,
    tipologias,
    vagas,
    lazer,
    endereco: local.endereco,
    bairro: local.bairro,
    cidade: local.cidade,
    uf: local.uf,
    cep: cep ? `${cep[1]}-${cep[2]}` : null,
    precoAPartirDe: preco,
    avisos,
  };
}

function posicao(n: string, l: LazerLido): number {
  const p = PALAVRAS_LAZER.find((x) => x.nome === l.nome);
  const i = p ? n.search(p.re) : n.search(/\b(jardim|jardins|praca|bosque)\b/);
  return i < 0 ? Infinity : i;
}
