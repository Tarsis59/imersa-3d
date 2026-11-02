import type { StatusUnidade } from '@imersa/viewer';
import type { CategoriaLazer } from './tipos';

/**
 * Comandos por texto (ou voz) na Vitrine (Plano 11e, item 20): "mostre as de 3 quartos com sol da manhã até 900 mil",
 * "vá para a piscina", "mostre à noite", "entra na 302". Só regras em português (grátis, na hora, sem sair do
 * navegador). Com a IA ligada, o assistente usa o mesmo formato de ações (ferramenta `comandar_vitrine`).
 * As ações só mexem na tela: nenhum dado é inventado (preço e situação vêm sempre do banco).
 */

export type PeriodoSol = 'manha' | 'tarde' | 'dia-todo' | 'pouco-sol';

export type AcaoComando =
  | { tipo: 'filtro'; quartos?: number[]; areaMin?: number; precoMax?: number; status?: StatusUnidade[]; favoritos?: boolean; sol?: PeriodoSol[] }
  | { tipo: 'limpar' }
  | { tipo: 'hora'; hora: number }
  | { tipo: 'estacao'; estacao: 'verao' | 'inverno' }
  | { tipo: 'clima'; clima: 'limpo' | 'nublado' }
  | { tipo: 'lazer'; categoria: CategoriaLazer | null; nome: string }
  | { tipo: 'tour_lazer' }
  | { tipo: 'unidade'; codigo: string; acao: 'mostrar' | 'entrar' | 'vista' }
  | { tipo: 'corte'; andar: number | null }
  | { tipo: 'modo'; modo: 'orbita' | 'primeira-pessoa' }
  | { tipo: 'visao_geral' }
  | { tipo: 'som'; ligado: boolean }
  | { tipo: 'separar_andares'; ligado: boolean }
  /** Corte "casa de bonecas" (Plano 12c, item 1): `andar: null` usa o andar já escolhido na tela. */
  | { tipo: 'casa_bonecas'; ligado: boolean; andar: number | null }
  /** Buscador de lotes do loteamento (Plano 12d, item 5): "lotes de até 300 mil na quadra 4". */
  | { tipo: 'filtro_lotes'; precoMax?: number; areaMin?: number; quadras?: string[]; status?: StatusUnidade[] }
  | { tipo: 'limpar_lotes' };

export interface Interpretacao {
  acoes: AcaoComando[];
  /** O que foi entendido, em palavras, para a pessoa conferir ("3 quartos · sol da manhã · até R$ 900 mil"). */
  resumo: string;
}

/** Mesma normalização da leitura do texto da criação (apps/api/src/criacao/texto.ts). */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[º°ª]/g, ' ')
    .replace(/[“”«»"!?¿¡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNIDADES: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400,
  quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900,
};
/** "três quartos" → "3 quartos"; "novecentos mil" → "900 mil"; "vinte e um" → "21". */
export function numeros(n: string): string {
  const p = n.split(' ');
  const out: string[] = [];
  for (let i = 0; i < p.length; i++) {
    let v = UNIDADES[p[i]!];
    if (v === undefined) {
      out.push(p[i]!);
      continue;
    }
    let j = i;
    while (p[j + 1] === 'e' && UNIDADES[p[j + 2] ?? ''] !== undefined && UNIDADES[p[j + 2]!]! < (v >= 100 ? 100 : v >= 20 ? 10 : 0)) {
      v += UNIDADES[p[j + 2]!]!;
      j += 2;
    }
    out.push(String(v));
    i = j;
  }
  return out.join(' ');
}

const LAZER: Array<{ re: RegExp; categoria: CategoriaLazer | null; nome: string }> = [
  { re: /\bpiscinas?\b/, categoria: 'piscina', nome: 'Piscina' },
  { re: /\b(academia|fitness)\b/, categoria: 'academia', nome: 'Academia' },
  { re: /\bsal(ao|oes) de festas?\b/, categoria: 'salao_festas', nome: 'Salão de festas' },
  { re: /\bchurrasqueiras?\b|\bchurrasco\b/, categoria: 'churrasqueira', nome: 'Churrasqueira' },
  { re: /\bgourmet\b/, categoria: 'espaco_gourmet', nome: 'Espaço gourmet' },
  { re: /\b(playground|parquinho)\b/, categoria: 'playground', nome: 'Playground' },
  { re: /\bbrinquedoteca\b/, categoria: 'brinquedoteca', nome: 'Brinquedoteca' },
  { re: /\bquadras?\b|\bbeach tennis\b/, categoria: 'quadra', nome: 'Quadra' },
  { re: /\bco-?working\b/, categoria: 'coworking', nome: 'Coworking' },
  { re: /\b(pet ?place|espaco pet)\b/, categoria: 'pet', nome: 'Espaço pet' },
  { re: /\b(jardim|praca)\b/, categoria: 'jardim', nome: 'Jardim' },
  { re: /\b(sauna|spa|rooftop|solarium|cinema|salao de jogos|lavanderia)\b/, categoria: null, nome: '' },
];

const STATUS: Array<[RegExp, StatusUnidade]> = [
  [/\b(disponive(l|is)|a venda|livres?)\b/, 'disponivel'],
  [/\breservad[ao]s?\b/, 'reservado'],
  [/\bvendid[ao]s?\b/, 'vendido'],
];

const ROTULO_SOL: Record<PeriodoSol, string> = { manha: 'sol da manhã', tarde: 'sol da tarde', 'dia-todo': 'sol o dia todo', 'pouco-sol': 'pouco sol' };

function dinheiro(numero: string, escala: string | undefined): number | null {
  const limpo = numero.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const v = Number(limpo);
  if (!Number.isFinite(v) || v <= 0) return null;
  const e = !escala ? 1 : /^(mil|k)$/.test(escala) ? 1e3 : 1e6;
  const total = Math.round(v * e);
  // "até 900" sozinho é milhar (ninguém procura imóvel de 900 reais)
  return total < 10_000 ? total * 1000 : total;
}

const reais = (v: number) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : `R$ ${Math.round(v / 1000)} mil`);

/** Lê o comando. Nunca lança; sem nada entendido, `acoes` volta vazia. */
export function interpretarComando(texto: string): Interpretacao {
  const n = numeros(normalizar(texto.slice(0, 300)));
  const acoes: AcaoComando[] = [];
  const partes: string[] = [];
  if (!n) return { acoes, resumo: '' };

  // limpar / mostrar todas
  if (/\b(limpa(r)?|tira(r)?|remove(r)?|apaga(r)?)\b.*\bfiltros?\b|\b(mostra(r)?|ver|ve) (todas|tudo|todos)\b|\bsem filtros?\b/.test(n)) {
    acoes.push({ tipo: 'limpar' });
    partes.push('sem filtros');
  }

  // loteamento (Plano 12d, item 5): "lotes" na frase manda o filtro/preço/área/status para o buscador de lotes,
  // não para o de unidades (prédio e loteamento nunca aparecem juntos na mesma Vitrine)
  const souLotes = /\blotes?\b/.test(n);
  if (souLotes) {
    if (/\b(limpa(r)?|tira(r)?|remove(r)?|apaga(r)?)\b.*\blotes?\b|\blotes? sem filtros?\b/.test(n)) {
      acoes.push({ tipo: 'limpar_lotes' });
      partes.push('lotes sem filtro');
    } else {
      const filtroLotes: Extract<AcaoComando, { tipo: 'filtro_lotes' }> = { tipo: 'filtro_lotes' };
      const pl = n.match(/\b(?:ate|no maximo|abaixo de|menos de|max(?:imo)?|por ate|teto de)\s*(?:r\$\s*)?(\d[\d.,]*)\s*(mil|k|milhao|milhoes|mi)?\b/);
      if (pl) {
        const v = dinheiro(pl[1]!, pl[2]);
        if (v !== null) filtroLotes.precoMax = v;
      }
      const al = n.match(/\b(?:acima de|mais de|pelo menos|minimo de|a partir de|maior que|com mais de)\s*(\d+)\s*(?:m2|m²|metros)/);
      if (al) filtroLotes.areaMin = Number(al[1]);
      const qd = n.match(/\bquadras?\s*(\d{1,3}(?:\s*(?:,|e|ou)\s*\d{1,3})*)\b/);
      if (qd) filtroLotes.quadras = [...new Set((qd[1]!.match(/\d+/g) ?? []).map((x) => x.padStart(2, '0')))];
      const stl = STATUS.filter(([re]) => re.test(n)).map(([, s]) => s);
      if (stl.length) filtroLotes.status = stl;
      if (Object.keys(filtroLotes).length > 1) {
        acoes.push(filtroLotes);
        partes.push('lotes' + (filtroLotes.quadras ? ` da quadra ${filtroLotes.quadras.join(' ou ')}` : '') + (filtroLotes.precoMax ? ` até ${reais(filtroLotes.precoMax)}` : '') + (filtroLotes.areaMin ? ` a partir de ${filtroLotes.areaMin} m²` : '') + (filtroLotes.status ? ` ${filtroLotes.status.map((s) => ({ disponivel: 'disponíveis', reservado: 'reservados', vendido: 'vendidos', bloqueado: 'bloqueados' })[s]).join(' e ')}` : ''));
      }
    }
  }

  // filtro (unidades do prédio)
  const filtro: Extract<AcaoComando, { tipo: 'filtro' }> = { tipo: 'filtro' };
  const q = n.match(/\b(\d+(?:\s*(?:,|e|ou|a)\s*\d+)*)\s*(?:quartos?|dorm\w*|qts?)\b/);
  if (q) {
    const faixa = q[1]!.match(/^(\d+)\s*a\s*(\d+)$/);
    const lista = faixa ? Array.from({ length: Math.max(0, Number(faixa[2]) - Number(faixa[1]) + 1) }, (_, k) => Number(faixa[1]) + k) : (q[1]!.match(/\d+/g) ?? []).map(Number);
    filtro.quartos = [...new Set(lista.filter((x) => x >= 0 && x <= 10))];
  } else if (/\b(studios?|kitnets?|lofts?)\b/.test(n)) filtro.quartos = [0];
  const p = !souLotes ? n.match(/\b(?:ate|no maximo|abaixo de|menos de|max(?:imo)?|por ate|teto de)\s*(?:r\$\s*)?(\d[\d.,]*)\s*(mil|k|milhao|milhoes|mi)?\b/) : null;
  if (p) {
    const v = dinheiro(p[1]!, p[2]);
    if (v !== null) filtro.precoMax = v;
  }
  const a = !souLotes ? n.match(/\b(?:acima de|mais de|pelo menos|minimo de|a partir de|maior que|com mais de)\s*(\d+)\s*(?:m2|m²|metros)/) : null;
  if (a) filtro.areaMin = Number(a[1]);
  const sol: PeriodoSol[] = [];
  if (/\bsol (da|de|pela) manha\b|\bsol nascente\b|\bnascente\b/.test(n)) sol.push('manha');
  if (/\bsol (da|de|pela) tarde\b|\bsol poente\b|\bpoente\b/.test(n)) sol.push('tarde');
  if (/\bsol o dia (todo|inteiro)\b|\bsol (o )?dia todo\b|\bmuito sol\b/.test(n)) sol.push('dia-todo');
  if (/\b(pouco sol|sem sol|fresc[ao]s?|sombra)\b/.test(n)) sol.push('pouco-sol');
  if (sol.length) filtro.sol = sol;
  const st = souLotes ? [] : STATUS.filter(([re]) => re.test(n)).map(([, s]) => s);
  if (st.length) filtro.status = st;
  if (/\bfavorit[ao]s?\b|\bque (eu )?gostei\b|\bque (eu )?salvei\b/.test(n)) filtro.favoritos = true;
  if (!souLotes && Object.keys(filtro).length > 1) {
    acoes.push(filtro);
    if (filtro.quartos) partes.push(filtro.quartos.map((x) => (x === 0 ? 'studio' : `${x} quarto${x > 1 ? 's' : ''}`)).join(' ou '));
    if (filtro.sol) partes.push(filtro.sol.map((s) => ROTULO_SOL[s]).join(' ou '));
    if (filtro.precoMax) partes.push(`até ${reais(filtro.precoMax)}`);
    if (filtro.areaMin) partes.push(`a partir de ${filtro.areaMin} m²`);
    if (filtro.status) partes.push(filtro.status.map((s) => ({ disponivel: 'disponíveis', reservado: 'reservadas', vendido: 'vendidas', bloqueado: 'bloqueadas' })[s]).join(' e '));
    if (filtro.favoritos) partes.push('favoritas');
  }

  // unidade pelo código: "entra na 302", "vista da 1201", "mostra a unidade A-1203"
  const u =
    n.match(/\b(?:unidade|apto?|apartamento|ap)\.?\s*(?:n\s*)?([a-z]?-?\d{2,5}[a-z]?)\b/) ??
    n.match(/\b(?:entra(?:r)?|entre|dentro|vista|ve|ver|mostra(?:r)?|mostre|leva|vai|va)\b[^0-9]{0,12}\b(?:na|no|da|do|a|o|pra|para)\s+([a-z]?-?\d{3,5}[a-z]?)\b/);
  if (u && !/\b\d+\s*(quartos?|m2|mil|andar)/.test(n.slice(n.indexOf(u[1]!), n.indexOf(u[1]!) + u[1]!.length + 9))) {
    const codigo = u[1]!.toUpperCase();
    const acao = /\b(entra(r)?|entre|dentro|por dentro|conhecer por dentro|visitar)\b/.test(n) ? 'entrar' : /\bvista\b|\bjanela\b/.test(n) ? 'vista' : 'mostrar';
    acoes.push({ tipo: 'unidade', codigo, acao });
    partes.push(acao === 'entrar' ? `entrar na ${codigo}` : acao === 'vista' ? `vista da ${codigo}` : `unidade ${codigo}`);
  }

  // lazer: tour ou um espaço
  if (/\b(tour|passeio|conhecer|conheca|mostra(r)?|mostre)\b.*\blazer\b|\blazer completo\b/.test(n) && !LAZER.some((l) => l.re.test(n))) {
    acoes.push({ tipo: 'tour_lazer' });
    partes.push('tour do lazer');
  } else {
    for (const l of LAZER) {
      const m = n.match(l.re);
      if (!m) continue;
      const nome = l.nome || m[0].replace(/\b\w/g, (c) => c.toUpperCase());
      acoes.push({ tipo: 'lazer', categoria: l.categoria, nome });
      partes.push(nome.toLowerCase());
      break;
    }
  }

  // hora do dia (o "sol da manhã" é filtro, não hora)
  let hora: number | null = null;
  const h = n.match(/\b(?:as|a|pelas?|de)\s*(\d{1,2})\s*(?:h|horas?|hs)\b/) ?? n.match(/\b(\d{1,2})\s*h\b/);
  // "10 da manhã", "3 da tarde", "8 da noite"
  const falada = n.match(/\b(\d{1,2})\s*(?:h|horas?|hs)?\s*da\s*(manha|tarde|noite|madrugada)\b/);
  if (falada && Number(falada[1]) >= 1 && Number(falada[1]) <= 12) {
    const x = Number(falada[1]);
    hora = falada[2] === 'tarde' ? (x === 12 ? 12 : x + 12) : falada[2] === 'noite' ? (x === 12 ? 0 : x + 12) : x === 12 ? 0 : x;
  } else if (h && Number(h[1]) <= 23) hora = Number(h[1]);
  else if (/\b(a|de|pela|durante a) noite\b|\bnoturn[ao]\b|\banoitecer\b/.test(n)) hora = 21;
  else if (/\b(por|pôr) do sol\b|\bentardecer\b|\bfim de tarde\b/.test(n)) hora = 18;
  else if (/\bnascer do sol\b|\bamanhecer\b|\balvorada\b/.test(n)) hora = 6;
  else if (/\bmeio dia\b|\bmeio-dia\b/.test(n)) hora = 12;
  else if (/\b(de|pela|na) manha\b/.test(n) && !sol.includes('manha')) hora = 9;
  else if (/\b(de|pela|a|na) tarde\b/.test(n) && !sol.includes('tarde')) hora = 15;
  else if (/\b(de|durante o) dia\b/.test(n) && !sol.length) hora = 12;
  if (hora !== null) {
    acoes.push({ tipo: 'hora', hora });
    partes.push(`às ${hora}h`);
  }
  if (/\b(no |de )?inverno\b/.test(n)) {
    acoes.push({ tipo: 'estacao', estacao: 'inverno' });
    partes.push('no inverno');
  } else if (/\b(no |de )?verao\b/.test(n)) {
    acoes.push({ tipo: 'estacao', estacao: 'verao' });
    partes.push('no verão');
  }
  if (/\b(nublado|chuva|chuvoso|chovendo|nuvens|garoa)\b/.test(n)) {
    acoes.push({ tipo: 'clima', clima: 'nublado' });
    partes.push('nublado');
  } else if (/\b(ceu limpo|ensolarado|tempo bom|sem nuvens|ceu azul)\b/.test(n)) {
    acoes.push({ tipo: 'clima', clima: 'limpo' });
    partes.push('céu limpo');
  }

  // corte por andar
  const c = n.match(/\b(?:corta(?:r)?|corte|ate o|so ate o|mostra(?:r)? ate o)\s*(?:no\s*)?(\d{1,3})\s*(?:o\s*)?andar\b/);
  if (c) {
    acoes.push({ tipo: 'corte', andar: Number(c[1]) });
    partes.push(`corte no ${c[1]}º andar`);
  } else if (/\b(tira(r)?|sem|remove(r)?) (o )?corte\b|\bpredio (todo|inteiro)\b/.test(n)) {
    acoes.push({ tipo: 'corte', andar: null });
    partes.push('prédio inteiro');
  }

  // corte "casa de bonecas" (Plano 12c, item 1): "casa de bonecas do 5º andar", "sai da casa de bonecas"
  if (/\b(tira(r)?|sai(r)?|fecha(r)?|sem)\b.{0,6}casa de bonecas\b/.test(n)) {
    acoes.push({ tipo: 'casa_bonecas', ligado: false, andar: null });
    partes.push('sem casa de bonecas');
  } else if (/\bcasa de bonecas\b/.test(n)) {
    const ca = n.match(/(\d{1,3})\s*(?:o\s*)?andar/);
    acoes.push({ tipo: 'casa_bonecas', ligado: true, andar: ca ? Number(ca[1]) : null });
    partes.push(ca ? `casa de bonecas do ${ca[1]}º andar` : 'casa de bonecas');
  }

  // câmera e som
  if (/\b(a pe|andar pelo|andar na|passear|primeira pessoa|caminhar|andando)\b/.test(n) && !acoes.some((x) => x.tipo === 'unidade')) {
    acoes.push({ tipo: 'modo', modo: 'primeira-pessoa' });
    partes.push('a pé');
  } else if (/\b(vista de cima|visao geral|volta(r)? (para|pro|ao) (o )?predio|mostra(r)? o predio( todo)?|de cima)\b/.test(n)) {
    acoes.push({ tipo: 'visao_geral' });
    partes.push('visão geral');
  }
  // vista explodida (os andares separados no alto)
  if (/\b(junta(r)?|une|unir|fecha(r)?) (os )?andares\b/.test(n)) {
    acoes.push({ tipo: 'separar_andares', ligado: false });
    partes.push('andares juntos');
  } else if (/\bexplodid[ao]\b|\bexplod(e|ir)\b|\b(separa(r)?|separe|abre|abrir|abra) (os )?andares\b|\bandares separados\b/.test(n)) {
    acoes.push({ tipo: 'separar_andares', ligado: true });
    partes.push('andares separados');
  }
  if (/\b(desliga(r)?|sem|tira(r)?|para(r)?) (o )?(som|barulho|audio)\b|\bsilencio\b|\bmudo\b/.test(n)) {
    acoes.push({ tipo: 'som', ligado: false });
    partes.push('sem som');
  } else if (/\b(liga(r)?|com|ativa(r)?|quero ouvir) (o )?(som|barulho|audio)\b|\bsom ambiente\b/.test(n)) {
    acoes.push({ tipo: 'som', ligado: true });
    partes.push('com som');
  }

  return { acoes, resumo: partes.join(' · ') };
}
