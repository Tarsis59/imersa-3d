/**
 * Câmera de arquitetura: verticais retas (Plano 12a, item 13). Olhar para cima faz as linhas verticais do prédio
 * parecerem convergir (o prédio "cai" para trás) — o mesmo defeito que a lente "tilt-shift" corrige em fotografia.
 * Em vez de inclinar a câmera (o que causa o efeito), ela fica nivelada (olha na horizontal) e o enquadramento é
 * deslocado no sentido vertical (frustum assimétrico, via `camera.setViewOffset`) para mostrar o mesmo ponto na
 * tela — as verticais do prédio ficam retas porque o sensor nunca inclinou. Só funciona numa faixa segura de ângulo
 * (perto do limite, o deslocamento cresce demais); fora dela, a câmera inclina normalmente.
 */

/** Até quantos graus para cima/baixo a correção continua boa (acima disso, o deslocamento fica exagerado). */
export const LIMITE_PITCH_VERTICAIS_RETAS_RAD = (35 * Math.PI) / 180;

/**
 * Ligada por padrão na órbita, dentro da faixa segura de pitch; sempre desligada na primeira pessoa (olhar livre,
 * sem arquitetura para "endireitar"). Pura: fácil de testar sem o 3D.
 */
export function verticaisRetasAtiva(modo: 'orbita' | 'primeira-pessoa', pitchRad: number): boolean {
  return modo === 'orbita' && Math.abs(pitchRad) <= LIMITE_PITCH_VERTICAIS_RETAS_RAD;
}

/**
 * Deslocamento vertical do frustum (fração da altura do quadro, no `offsetY` de `camera.setViewOffset`) que faz uma
 * câmera NIVELADA (sem inclinar) mostrar o mesmo enquadramento que uma câmera inclinada por `pitchRad` mostraria —
 * dedução do "shift lens": na distância focal `near`, o alvo que a câmera inclinada olha de frente cai, no plano
 * próximo da câmera nivelada, a `near·tan(pitch)` do centro; para recentrar esse ponto, o TOPO do frustum precisa
 * subir o mesmo tanto (`top_novo = top_velho + near·tan(pitch)`). Como o three.js calcula `top -= altura·offsetY/
 * alturaTotal`, isso dá `offsetY/alturaTotal = −tan(pitch) / (2·tan(fov/2))` (a altura do frustum é
 * `2·near·tan(fov/2)`, e o `near` cancela).
 */
export function calcularShiftVertical(pitchRad: number, fovVerticalGraus: number): number {
  const meioFov = (fovVerticalGraus * Math.PI) / 360;
  return -Math.tan(pitchRad) / (2 * Math.tan(meioFov));
}

/** Pitch (rad) do olhar entre `camera` e `alvo`: positivo olhando para cima, negativo para baixo, 0 na horizontal. */
export function pitchDoOlhar(posicao: { x: number; y: number; z: number }, alvo: { x: number; y: number; z: number }): number {
  const dx = alvo.x - posicao.x;
  const dy = alvo.y - posicao.y;
  const dz = alvo.z - posicao.z;
  const horizontal = Math.hypot(dx, dz);
  return Math.atan2(dy, horizontal);
}
