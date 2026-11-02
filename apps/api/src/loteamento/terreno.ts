import type { Dxf } from './dxf';
import { utmParaLatLon } from './utm';

/**
 * Terreno e infraestrutura do loteamento (Plano 12d, item 8): ruas, meio-fio, calçadas e o relevo das curvas de
 * nível, lidos do mesmo DXF dos lotes. Aceita os nomes de layer mais comuns dos projetos de parcelamento
 * (documentado abaixo de cada expressão); quem usa outro nome pode informar o layer certo na importação.
 */
export interface TerrenoLido {
  /** Eixo das ruas (polilinha aberta), em [lon, lat]. */
  ruas: Array<Array<[number, number]>>;
  calcadas: Array<Array<[number, number]>>;
  meioFio: Array<Array<[number, number]>>;
  /** Curvas de nível: o desenho e a cota (metros) de cada uma. */
  curvas: Array<{ pontos: Array<[number, number]>; elevacaoM: number }>;
  avisos: string[];
}

export interface OpcoesTerreno {
  /** Fuso UTM do levantamento (igual ao dos lotes); sem fuso, o DXF já está em lon/lat (graus). */
  fuso?: number;
  sul?: boolean;
  camadaRuas?: RegExp;
  camadaCalcadas?: RegExp;
  camadaMeioFio?: RegExp;
  camadaCurvas?: RegExp;
}

/** RUAS, VIAS, SISTEMA_VIARIO (e variações com separador). */
const RE_RUAS = /\b(ruas?|vias?|sistema[_ ]?viario|arruamento)\b/i;
/** CALCADAS, PASSEIO. */
const RE_CALCADAS = /cal[cç]ad|passeio/i;
/** MEIO_FIO, MEIO-FIO, GUIA (nome comum do meio-fio em alguns escritórios). */
const RE_MEIO_FIO = /meio[_ -]?fio|^guias?$/i;
/** CURVAS, CURVA_DE_NIVEL, CN. */
const RE_CURVAS = /curvas?|^cn$/i;

type P = [number, number];

/**
 * Lê o terreno do mesmo DXF do parcelamento (chamar junto de `lotesDoDxf`, com o mesmo fuso). Sem nenhuma das
 * camadas, devolve tudo vazio (o viewer continua com o relevo AWS e sem ruas desenhadas: funciona, só "mais
 * tabuleiro"). Linhas sem pelo menos 2 pontos válidos são ignoradas.
 */
export function terrenoDoDxf(dxf: Dxf, o: OpcoesTerreno = {}): TerrenoLido {
  const avisos: string[] = [];
  const emGraus = o.fuso === undefined;
  const paraLonLat = (q: P): P => {
    if (emGraus) return q;
    const g = utmParaLatLon(q[0], q[1], o.fuso!, o.sul ?? true);
    return [Math.round(g.lon * 1e8) / 1e8, Math.round(g.lat * 1e8) / 1e8];
  };
  const linhas = (re: RegExp) => dxf.polilinhas.filter((p) => re.test(p.camada) && p.pontos.length >= 2).map((p) => p.pontos.map(paraLonLat));
  const ruas = linhas(o.camadaRuas ?? RE_RUAS);
  const calcadas = linhas(o.camadaCalcadas ?? RE_CALCADAS);
  const meioFio = linhas(o.camadaMeioFio ?? RE_MEIO_FIO);
  const curvasPoli = dxf.polilinhas.filter((p) => (o.camadaCurvas ?? RE_CURVAS).test(p.camada) && p.pontos.length >= 2);
  const curvas: TerrenoLido['curvas'] = [];
  for (const p of curvasPoli) {
    if (p.elevacao === null) {
      avisos.push(`Curva de nível no layer ${p.camada} sem cota (código 38 ou z do vértice): ficou de fora.`);
      continue;
    }
    curvas.push({ pontos: p.pontos.map(paraLonLat), elevacaoM: p.elevacao });
  }
  if (!ruas.length && !calcadas.length && !meioFio.length && !curvas.length) {
    avisos.push('Nenhuma rua, calçada, meio-fio ou curva de nível encontrada (layers aceitos: RUAS/VIAS/SISTEMA_VIARIO, CALCADAS, MEIO_FIO, CURVAS/CN).');
  }
  return { ruas, calcadas, meioFio, curvas, avisos };
}
