import type { Caixa } from './tipos';

/**
 * Corte "casa de bonecas" (Plano 12c, item 1): no andar escolhido, em vez da unidade inteira (um volume sólido),
 * mostra as paredes dela, pintadas pela situação, igual a uma maquete aberta por cima. Paredes de verdade (do BIM
 * ou da planta 07c) sempre mandam; isto aqui é só o contorno gerado quando a unidade não tem nenhuma das duas — a
 * própria caixa da unidade já é o contorno (4 lados).
 */

/** Altura da parede baixa (porta + um pouco): acima dela, só o vidro translúcido até a laje. */
export const ALTURA_PAREDE_BAIXA_M = 2.6;
const ESPESSURA_PAREDE_M = 0.12;

export interface ParedeGerada {
  caixa: Caixa;
  /** Acima da parede baixa: translúcida, para não esconder o andar debaixo nem o de cima feito maquete. */
  translucida: boolean;
}

/**
 * 4 paredes no contorno da caixa da unidade. Baixas (ALTURA_PAREDE_BAIXA_M); se a unidade for mais alta que isso,
 * o resto até o topo vira uma 2ª faixa translúcida. Os cantos não se repetem (as paredes dos lados ficam entre as
 * da frente e do fundo).
 */
/**
 * Escolhe a fonte das paredes: o prédio com modelo (BIM/GLB) já tem paredes de verdade (vindas do IFC) e cada
 * unidade já pinta pela situação sozinha (a peça dela, pelo `pintar()` de sempre); aí elas mandam — só falta
 * tirar a laje de cima (o corte de sempre já faz isso, porque as paredes entram nos materiais do prédio). Sem
 * modelo (prédio desenhado, "sólidos" vazio), não há parede nenhuma: cai no contorno gerado.
 */
export function usarParedesDoModelo(temSolidosDoModelo: boolean): boolean {
  return temSolidosDoModelo;
}

export function paredesDoContorno(caixa: Caixa): ParedeGerada[] {
  const e = ESPESSURA_PAREDE_M;
  const baixo = Math.min(caixa.maxY, caixa.minY + ALTURA_PAREDE_BAIXA_M);
  const tiras: Array<[number, number, number, number]> = [
    [caixa.minX, caixa.maxX, caixa.minZ, caixa.minZ + e], // frente
    [caixa.minX, caixa.maxX, caixa.maxZ - e, caixa.maxZ], // fundo
    [caixa.minX, caixa.minX + e, caixa.minZ + e, caixa.maxZ - e], // esquerda (sem repetir os cantos)
    [caixa.maxX - e, caixa.maxX, caixa.minZ + e, caixa.maxZ - e], // direita
  ];
  const paredes: ParedeGerada[] = [];
  for (const [minX, maxX, minZ, maxZ] of tiras) {
    paredes.push({ caixa: { minX, maxX, minY: caixa.minY, maxY: baixo, minZ, maxZ }, translucida: false });
    if (baixo < caixa.maxY) paredes.push({ caixa: { minX, maxX, minY: baixo, maxY: caixa.maxY, minZ, maxZ }, translucida: true });
  }
  return paredes;
}
