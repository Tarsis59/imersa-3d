/**
 * Superfícies do modelo que a cliente pode personalizar. No BIM, o tipo IFC de cada peça (gravado pelo conversor
 * nos extras do glTF) diz o que ela é; num GLB comum, o nome do material agrupa as peças.
 */
export type CategoriaMaterial = 'piso' | 'parede' | 'teto' | 'telhado' | 'esquadria' | 'bancada' | 'outro';
/** Que faces contam na área: viradas para cima (piso), para cima mesmo que inclinadas (telhado), verticais (parede) ou todas. */
export type Orientacao = 'cima' | 'inclinada' | 'vertical' | 'todas';

export interface DefinicaoGrupo {
  chave: string;
  rotulo: string;
  categoria: CategoriaMaterial;
  orientacao: Orientacao;
}

const GRUPOS_IFC: Record<string, DefinicaoGrupo> = {
  pisos: { chave: 'pisos', rotulo: 'Pisos e lajes', categoria: 'piso', orientacao: 'cima' },
  paredes: { chave: 'paredes', rotulo: 'Paredes', categoria: 'parede', orientacao: 'vertical' },
  forros: { chave: 'forros', rotulo: 'Forros', categoria: 'teto', orientacao: 'todas' },
  telhado: { chave: 'telhado', rotulo: 'Telhado', categoria: 'telhado', orientacao: 'inclinada' },
  esquadrias: { chave: 'esquadrias', rotulo: 'Portas e janelas', categoria: 'esquadria', orientacao: 'todas' },
  escadas: { chave: 'escadas', rotulo: 'Escadas e guarda-corpos', categoria: 'piso', orientacao: 'cima' },
  estrutura: { chave: 'estrutura', rotulo: 'Pilares e vigas', categoria: 'parede', orientacao: 'vertical' },
  bancadas: { chave: 'bancadas', rotulo: 'Bancadas e louças', categoria: 'bancada', orientacao: 'todas' },
};

/** Tipo IFC (sem o sufixo StandardCase) → grupo. Ambientes (IfcSpace) são ar e não entram. */
const POR_TIPO: Record<string, keyof typeof GRUPOS_IFC> = {
  IfcSlab: 'pisos',
  IfcCovering: 'forros',
  IfcWall: 'paredes',
  IfcCurtainWall: 'paredes',
  IfcPlate: 'paredes',
  IfcRoof: 'telhado',
  IfcDoor: 'esquadrias',
  IfcWindow: 'esquadrias',
  IfcStair: 'escadas',
  IfcStairFlight: 'escadas',
  IfcRamp: 'escadas',
  IfcRampFlight: 'escadas',
  IfcRailing: 'escadas',
  IfcColumn: 'estrutura',
  IfcBeam: 'estrutura',
  IfcMember: 'estrutura',
  IfcFurnishingElement: 'bancadas',
  IfcFlowTerminal: 'bancadas',
  IfcSanitaryTerminal: 'bancadas',
};

const normalizarTipo = (t: string) => t.replace(/StandardCase$|ElementedCase$/, '');

/** O que o conversor BIM grava nos extras de cada peça (além do tipo): tipo predefinido e conjunto ao qual pertence. */
export interface DetalheIfc {
  /** PredefinedType do IFC: laje ROOF × FLOOR × BASESLAB, forro CEILING × FLOORING × ROOFING… */
  predefinido?: string;
  /** Elemento que agrega a peça (as lajes de um telhado ficam dentro de um IfcRoof). */
  pai?: string;
}

/** Grupo de uma peça, ou `null` se ela não se personaliza (ambiente, peça sem tipo nem material). */
export function grupoDaPeca(tipoIfc: string | undefined, nomeMaterial: string | undefined, detalhe: DetalheIfc = {}): DefinicaoGrupo | null {
  if (tipoIfc) {
    if (tipoIfc === 'IfcSpace' || tipoIfc === 'IfcOpeningElement') return null;
    const tipo = normalizarTipo(tipoIfc);
    // telhado modelado como laje ou cobertura: pelo tipo predefinido ou por estar dentro de um IfcRoof
    if ((tipo === 'IfcSlab' || tipo === 'IfcCovering') && (detalhe.predefinido === 'ROOF' || detalhe.predefinido === 'ROOFING' || detalhe.pai === 'IfcRoof')) return GRUPOS_IFC.telhado!;
    if (tipo === 'IfcCovering' && detalhe.predefinido === 'FLOORING') return GRUPOS_IFC.pisos!;
    const g = POR_TIPO[tipo];
    return g ? GRUPOS_IFC[g]! : { chave: 'outros', rotulo: 'Outros elementos', categoria: 'outro', orientacao: 'todas' };
  }
  const nome = nomeMaterial?.trim();
  if (!nome) return null;
  return { chave: `material:${nome}`, rotulo: nome, categoria: categoriaPeloNome(nome), orientacao: 'todas' };
}

/** GLB sem IFC: adivinha a categoria pelo nome do material, para já filtrar o catálogo certo. */
export function categoriaPeloNome(nome: string): CategoriaMaterial {
  const n = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/piso|floor|chao|porcelanato|laminado|tile/.test(n)) return 'piso';
  if (/parede|wall|pintura|paint|reboco/.test(n)) return 'parede';
  if (/forro|teto|ceiling/.test(n)) return 'teto';
  if (/telha|roof|telhado/.test(n)) return 'telhado';
  if (/porta|janela|door|window|esquadria|vidro|glass/.test(n)) return 'esquadria';
  if (/bancada|granito|marmore|counter|pia/.test(n)) return 'bancada';
  return 'outro';
}

/** Ordem de exibição: o que mais muda o visual primeiro. */
export const ORDEM_GRUPOS = ['pisos', 'paredes', 'telhado', 'forros', 'esquadrias', 'bancadas', 'escadas', 'estrutura', 'outros'];

export function ordenarGrupos<T extends { chave: string; rotulo: string }>(grupos: T[]): T[] {
  const pos = (c: string) => (ORDEM_GRUPOS.includes(c) ? ORDEM_GRUPOS.indexOf(c) : ORDEM_GRUPOS.length);
  return [...grupos].sort((a, b) => pos(a.chave) - pos(b.chave) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

/**
 * Área (m²) das faces de uma malha na orientação pedida, já no espaço do mundo (`matriz` = matrixWorld, coluna
 * maior, como no three). `indices` nulo = triângulos em sequência.
 */
export function areaVisivel(posicoes: ArrayLike<number>, indices: ArrayLike<number> | null, matriz: ArrayLike<number>, orientacao: Orientacao): number {
  const m = matriz;
  const p = (i: number, saida: number[]) => {
    const x = posicoes[i * 3]!;
    const y = posicoes[i * 3 + 1]!;
    const z = posicoes[i * 3 + 2]!;
    saida[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    saida[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    saida[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  };
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  const total = indices ? indices.length : posicoes.length / 3;
  let area = 0;
  for (let t = 0; t + 2 < total; t += 3) {
    p(indices ? indices[t]! : t, a);
    p(indices ? indices[t + 1]! : t + 1, b);
    p(indices ? indices[t + 2]! : t + 2, c);
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dobro = Math.hypot(nx, ny, nz);
    if (dobro === 0) continue;
    const vertical = ny / dobro; // componente Y da normal unitária
    if (orientacao === 'cima' && vertical < 0.7) continue;
    // telhado: qualquer água virada para cima (até ~78° de inclinação)
    if (orientacao === 'inclinada' && vertical < 0.2) continue;
    if (orientacao === 'vertical' && Math.abs(vertical) > 0.3) continue;
    area += dobro / 2;
  }
  return area;
}
