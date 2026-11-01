import type { LinhaPlanilha } from '../dominio/planilha';
import { LIMITE_LINHAS } from '../dominio/planilha';
import { areaTipica, type CategoriaLazer, type Descricao, type TipologiaLida } from './texto';

/** Mesmas medidas da fachada procedural do 3D (`packages/viewer/src/units/massa.ts`): lazer cai fora do prédio. */
const LADO_UNIDADE_M = 8;
const ALTURA_ANDAR_M = 3;
const MAX_POR_ANDAR = 20;
const MAX_TORRES = 6;
const MAX_ANDARES = 120;
/** Afastamento do lazer do térreo em relação à fachada (calçada + jardim). */
const AFASTAMENTO_M = 9;
const NO_TERRACO = new Set(['Rooftop', 'Solarium']);

export interface LazerPlanejado {
  categoria: CategoriaLazer;
  nome: string;
  x: number;
  y: number;
  z: number;
  ordem: number;
}

export interface PlanoPredio {
  linhas: LinhaPlanilha[];
  tipologias: TipologiaLida[];
  predios: string[];
  andares: number;
  porAndar: number;
  lazer: LazerPlanejado[];
  /** O que o plano decidiu sozinho (a pessoa vê antes de confirmar). */
  avisos: string[];
}

/** Posições do andar da mais "de canto" (maior) para a de miolo: a grade é a mesma da fachada procedural. */
export function ordemDeCanto(porAndar: number): number[] {
  const colunas = Math.ceil(Math.sqrt(porAndar));
  const linhas = Math.ceil(porAndar / colunas);
  const peso = (i: number) => {
    const c = i % colunas;
    const l = Math.floor(i / colunas);
    const bordaC = c === 0 || c === colunas - 1;
    const bordaL = l === 0 || l === linhas - 1;
    return bordaC && bordaL ? 0 : bordaC || bordaL ? 1 : 2;
  };
  return Array.from({ length: porAndar }, (_, i) => i).sort((a, b) => peso(a) - peso(b) || a - b);
}

/** Quantas de cada tipologia por andar: o mais parelho possível, a sobra para as menores (mais procuradas). */
export function distribuir(porAndar: number, tipos: number): number[] {
  const base = Math.floor(porAndar / tipos);
  return Array.from({ length: tipos }, (_, i) => base + (i < porAndar % tipos ? 1 : 0));
}

/**
 * Pontos do lazer em volta do prédio desenhado (térreo) ou no terraço, na ordem do texto. Ficam a `AFASTAMENTO_M` da
 * fachada, espalhados em leque pela frente e pelos lados; a gestão arrasta depois se quiser.
 */
export function posicionarLazer(itens: ReadonlyArray<{ categoria: CategoriaLazer; nome: string }>, porAndar: number, andares: number): LazerPlanejado[] {
  const colunas = Math.ceil(Math.sqrt(porAndar));
  const linhas = Math.ceil(porAndar / colunas);
  const meioX = (colunas * LADO_UNIDADE_M) / 2;
  const meioZ = (linhas * LADO_UNIDADE_M) / 2;
  const noChao = itens.filter((i) => !NO_TERRACO.has(i.nome));
  const raio = Math.hypot(meioX, meioZ) + AFASTAMENTO_M;
  let k = 0;
  return itens.map((item, ordem) => {
    if (NO_TERRACO.has(item.nome)) return { ...item, x: 0, y: andares * ALTURA_ANDAR_M, z: 0, ordem };
    // leque de -150° a 150° partindo da frente (+z), sem repetir lugar
    const n = noChao.length;
    const ang = n === 1 ? 0 : ((-150 + (300 * k) / (n - 1)) * Math.PI) / 180;
    k++;
    const r = (v: number) => Math.round(v * 10) / 10;
    return { ...item, x: r(Math.sin(ang) * raio), y: 0, z: r(Math.cos(ang) * raio), ordem };
  });
}

/**
 * Descrição lida → linhas de planilha (as mesmas da importação: grava pelo mesmo caminho, com as mesmas regras) e o
 * lazer posicionado. Preço nunca sai do texto: as unidades nascem sem preço (a gestão ou a planilha põe).
 * `null` quando não dá para saber quantos andares (a tela pede esse número).
 */
export function planoDoPredio(d: Descricao): PlanoPredio | null {
  const avisos: string[] = [];
  const torres = Math.min(MAX_TORRES, Math.max(1, d.torres ?? 1));
  let porAndar = d.unidadesPorAndar;
  let andares = d.andares;
  if (andares === null && d.totalUnidades !== null && porAndar !== null) andares = Math.ceil(d.totalUnidades / torres / porAndar);
  if (andares === null) return null;
  andares = Math.min(MAX_ANDARES, andares);
  if (porAndar === null) {
    if (d.totalUnidades !== null) porAndar = Math.max(1, Math.round(d.totalUnidades / torres / andares));
    else {
      porAndar = 4;
      avisos.push('O texto não diz quantas unidades por andar: usei 4.');
    }
  }
  porAndar = Math.min(MAX_POR_ANDAR, Math.max(1, porAndar));

  let tipologias = d.tipologias.map((t) => ({ ...t }));
  if (!tipologias.length) {
    tipologias = [{ nome: '2 quartos', quartos: 2, suites: 0, areaM2: null }];
    avisos.push('O texto não diz as tipologias: usei 2 quartos.');
  }
  // mais tipologias que unidades por andar: ficam as primeiras (as outras a gestão cria)
  if (tipologias.length > porAndar) {
    avisos.push(`São ${tipologias.length} tipologias e só ${porAndar} unidades por andar: usei as ${porAndar} primeiras.`);
    tipologias = tipologias.slice(0, porAndar);
  }
  for (const t of tipologias) {
    if (t.areaM2 === null) {
      t.areaM2 = areaTipica(t.quartos);
      avisos.push(`Área de "${t.nome}" não veio no texto: usei ${t.areaM2} m² (ajuste nas tipologias).`);
    }
  }

  // tipologia de cada posição do andar: as maiores nos cantos
  const contagem = distribuir(porAndar, tipologias.length);
  const daPosicao: number[] = new Array(porAndar);
  const cantos = ordemDeCanto(porAndar);
  let p = 0;
  for (let t = tipologias.length - 1; t >= 0; t--) for (let i = 0; i < contagem[t]!; i++) daPosicao[cantos[p++]!] = t;

  const predios = Array.from({ length: torres }, (_, i) => (torres === 1 ? 'Torre A' : `Torre ${String.fromCharCode(65 + i)}`));
  const linhas: LinhaPlanilha[] = [];
  let linha = 2;
  for (const predio of predios) {
    for (let andar = 1; andar <= andares; andar++) {
      for (let pos = 0; pos < porAndar; pos++) {
        const t = tipologias[daPosicao[pos]!]!;
        linhas.push({
          linha: linha++,
          predio,
          andar,
          codigo: `${andar}${String(pos + 1).padStart(2, '0')}`,
          tipologia: t.nome,
          areaM2: t.areaM2,
          quartos: t.quartos,
          suites: t.suites,
          vagas: d.vagas,
          preco: null,
          status: null,
        });
      }
    }
  }
  if (linhas.length > LIMITE_LINHAS) return null;
  return { linhas, tipologias, predios, andares, porAndar, lazer: posicionarLazer(d.lazer, porAndar, andares), avisos };
}
