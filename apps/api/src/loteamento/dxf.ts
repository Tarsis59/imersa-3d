/**
 * Leitura do DXF do parcelamento (Plano 12d): polilinhas fechadas (lotes, quadras) e textos (número do lote, nome
 * da quadra), por layer. Só o que o loteamento precisa; DXF em texto (ASCII), que é o que o AutoCAD, o QGIS e o
 * ODA File Converter (DWG → DXF, grátis) exportam.
 */
export interface PolilinhaDxf {
  camada: string;
  fechada: boolean;
  pontos: Array<[number, number]>;
}
export interface TextoDxf {
  camada: string;
  x: number;
  y: number;
  texto: string;
}
export interface Dxf {
  polilinhas: PolilinhaDxf[];
  textos: TextoDxf[];
}

/** Tira a formatação do MTEXT ("\\P" quebra, "{\\fArial;12}" fonte, "\\A1;" alinhamento). */
function textoLimpo(t: string): string {
  return t
    .replace(/\\P/gi, ' ')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lerDxf(conteudo: string): Dxf {
  const linhas = conteudo.replace(/\r\n?/g, '\n').split('\n');
  const pares: Array<[number, string]> = [];
  for (let i = 0; i + 1 < linhas.length; i += 2) {
    const codigo = Number(linhas[i]!.trim());
    if (!Number.isInteger(codigo)) throw new Error('dxf_invalido');
    pares.push([codigo, linhas[i + 1]!.trim()]);
  }
  const polilinhas: PolilinhaDxf[] = [];
  const textos: TextoDxf[] = [];
  let naSecaoEntidades = false;
  let i = 0;
  // uma entidade vai do "0 <TIPO>" até o próximo código 0
  const entidade = () => {
    const tipo = pares[i]![1];
    const campos: Array<[number, string]> = [];
    i++;
    while (i < pares.length && pares[i]![0] !== 0) campos.push(pares[i++]!);
    return { tipo, campos };
  };
  while (i < pares.length) {
    const [c, v] = pares[i]!;
    if (c === 0 && v === 'SECTION') {
      naSecaoEntidades = pares[i + 1]?.[0] === 2 && pares[i + 1]?.[1] === 'ENTITIES';
      i += 2;
      continue;
    }
    if (c === 0 && v === 'ENDSEC') {
      naSecaoEntidades = false;
      i++;
      continue;
    }
    if (!naSecaoEntidades || c !== 0) {
      i++;
      continue;
    }
    const e = entidade();
    const camada = e.campos.find(([k]) => k === 8)?.[1] ?? '0';
    if (e.tipo === 'LWPOLYLINE') {
      const flags = Number(e.campos.find(([k]) => k === 70)?.[1] ?? 0);
      const pontos: Array<[number, number]> = [];
      for (let k = 0; k < e.campos.length; k++) {
        if (e.campos[k]![0] === 10) pontos.push([Number(e.campos[k]![1]), Number(e.campos.slice(k + 1).find(([q]) => q === 20)?.[1])]);
      }
      polilinhas.push({ camada, fechada: (flags & 1) === 1, pontos });
    } else if (e.tipo === 'POLYLINE') {
      // formato antigo: os vértices vêm em entidades VERTEX até o SEQEND
      const flags = Number(e.campos.find(([k]) => k === 70)?.[1] ?? 0);
      const pontos: Array<[number, number]> = [];
      while (i < pares.length && pares[i]![1] === 'VERTEX') {
        const v2 = entidade();
        pontos.push([Number(v2.campos.find(([k]) => k === 10)?.[1]), Number(v2.campos.find(([k]) => k === 20)?.[1])]);
      }
      if (pares[i]?.[1] === 'SEQEND') entidade();
      polilinhas.push({ camada, fechada: (flags & 1) === 1, pontos });
    } else if (e.tipo === 'TEXT' || e.tipo === 'MTEXT') {
      const texto = textoLimpo(e.campos.filter(([k]) => k === 1 || k === 3).map(([, t]) => t).join(''));
      const x = Number(e.campos.find(([k]) => k === 10)?.[1]);
      const y = Number(e.campos.find(([k]) => k === 20)?.[1]);
      if (texto && Number.isFinite(x) && Number.isFinite(y)) textos.push({ camada, x, y, texto });
    }
  }
  return { polilinhas: polilinhas.filter((p) => p.pontos.length >= 3 && p.pontos.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))), textos };
}
