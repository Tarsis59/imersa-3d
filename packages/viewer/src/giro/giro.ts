/** Quantas unidades cabem na máscara: cada uma vira uma cor RGB única (o preto fica para "nenhuma"). */
export const MAX_UNIDADES_GIRO = 256 ** 3 - 1;

/** Índice da unidade → cor RGB (0–255) da máscara. */
export function corDoIndice(i: number): [number, number, number] {
  if (!Number.isInteger(i) || i < 0 || i >= MAX_UNIDADES_GIRO) throw new Error(`Índice fora da máscara: ${i}`);
  const v = i + 1;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Cor lida na máscara → índice da unidade; preto = nenhuma. */
export function indiceDaCor(r: number, g: number, b: number): number | null {
  const v = (r << 16) | (g << 8) | b;
  return v === 0 ? null : v - 1;
}

/** Arrastar a largura inteira do giro = uma volta completa. Volta ao início dos dois lados. */
export function quadroPorArrasto(atual: number, dxPx: number, larguraPx: number, total: number): number {
  const passos = Math.round((dxPx / larguraPx) * total);
  return (((atual + passos) % total) + total) % total;
}

export interface Ponto3 {
  x: number;
  y: number;
  z: number;
}

/** Câmera do quadro: círculo em volta do centro, a `elevacaoGraus` acima do horizonte, olhando para o centro. */
export function poseNoGiro(quadro: number, total: number, centro: Ponto3, distancia: number, elevacaoGraus: number, anguloInicial: number): { posicao: Ponto3; alvo: Ponto3 } {
  const a = anguloInicial + (quadro / total) * Math.PI * 2;
  const el = (elevacaoGraus * Math.PI) / 180;
  const h = Math.cos(el) * distancia;
  return {
    posicao: { x: centro.x + Math.sin(a) * h, y: centro.y + Math.sin(el) * distancia, z: centro.z + Math.cos(a) * h },
    alvo: { ...centro },
  };
}
