import type { Caixa } from '../units/tipos';

export interface EstadoPessoa {
  x: number;
  z: number;
  /** Altura dos pés (piso onde a pessoa está); 0 = térreo. */
  y?: number;
  /** Radianos; 0 = olhando para o norte (−z), positivo gira para a esquerda (oeste). */
  yaw: number;
}

/** −1..1 em cada eixo (teclado ou joystick). */
export interface Entrada {
  frente: number;
  lado: number;
}

export interface Ponto2D {
  x: number;
  z: number;
  /** Altura dos pés (para saber que paredes ficam na altura do corpo). */
  y?: number;
}

export interface OpcoesPasso {
  /** Metros por segundo. */
  velocidade: number;
  /** `true` se não dá para ir de `de` até `para` (parede, prédio). */
  bloqueado: (de: Ponto2D, para: Ponto2D) => boolean;
}

/**
 * Um passo: anda para onde olha, sem ficar mais rápido na diagonal. Colisão por eixo separado:
 * se o movimento inteiro bate, tenta só x e depois só z (desliza ao longo da parede).
 */
export function passoPrimeiraPessoa(e: EstadoPessoa, entrada: Entrada, dt: number, o: OpcoesPasso): EstadoPessoa {
  let { frente, lado } = entrada;
  const tamanho = Math.hypot(frente, lado);
  if (tamanho === 0 || dt <= 0) return e;
  if (tamanho > 1) {
    frente /= tamanho;
    lado /= tamanho;
  }
  const d = o.velocidade * dt;
  const seno = Math.sin(e.yaw);
  const cosseno = Math.cos(e.yaw);
  const dx = (-seno * frente + cosseno * lado) * d;
  const dz = (-cosseno * frente - seno * lado) * d;
  const de = { x: e.x, z: e.z, y: e.y ?? 0 };
  const candidatos = [
    { x: e.x + dx, z: e.z + dz, y: de.y },
    { x: e.x + dx, z: e.z, y: de.y },
    { x: e.x, z: e.z + dz, y: de.y },
  ];
  for (const c of candidatos) if (!o.bloqueado(de, c)) return { ...e, x: c.x, z: c.z };
  return e;
}

/**
 * Bloqueio contra caixas (volumes do prédio): as faces da caixa são paredes, por fora e por dentro (dá para andar
 * dentro de um apartamento sem atravessar a parede). O corpo é um cilindro de `raio`, dos pés + 0,3 m de degrau até
 * os olhos; caixa acima da cabeça ou abaixo dos pés não bloqueia. Confere o caminho inteiro, não só o ponto final:
 * com FPS baixo o passo fica grande e atravessaria paredes finas.
 */
export function bloqueioPorCaixas(caixas: readonly Caixa[], raio: number, alturaOlhos: number): OpcoesPasso['bloqueado'] {
  const naParede = (c: Caixa, p: Ponto2D) => {
    const fora = p.x <= c.minX - raio || p.x >= c.maxX + raio || p.z <= c.minZ - raio || p.z >= c.maxZ + raio;
    const dentro = p.x > c.minX + raio && p.x < c.maxX - raio && p.z > c.minZ + raio && p.z < c.maxZ - raio;
    return !fora && !dentro;
  };
  return (de, para) => {
    const pes = (de.y ?? 0) + 0.3;
    const olhos = (de.y ?? 0) + alturaOlhos;
    const altura = caixas.filter((c) => c.maxY > pes && c.minY < olhos);
    const amostras = Math.max(1, Math.ceil(Math.hypot(para.x - de.x, para.z - de.z) / (raio / 2)));
    for (let i = 1; i <= amostras; i++) {
      const t = i / amostras;
      const p = { x: de.x + (para.x - de.x) * t, z: de.z + (para.z - de.z) * t };
      if (altura.some((c) => naParede(c, p))) return true;
    }
    return false;
  };
}

/** Degrau mais alto que se sobe andando (escada, meio-fio, rampa); acima disso é parede. */
export const DEGRAU_M = 0.45;

/**
 * Altura dos pés depois de um passo: o piso logo abaixo (procurando a partir de um degrau acima dos pés). Sobe
 * escada e rampa; desce para o piso de baixo. `pisoEm` = altura do piso sob (x, z) procurando de `deY` para baixo.
 */
export function seguirPiso(yPes: number, x: number, z: number, pisoEm: (x: number, z: number, deY: number) => number | null): number {
  const h = pisoEm(x, z, yPes + DEGRAU_M);
  return h === null ? yPes : h;
}

/** Yaw que olha para (dx, dz): 0 = norte (−z). */
export const yawPara = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

/** Diferença de ângulo pelo menor caminho (−π..π). */
export const diferencaAngulo = (de: number, para: number): number => Math.atan2(Math.sin(para - de), Math.cos(para - de));

/** Tocar para ir: vira para o ponto e anda quando já está de frente; `chegou` com menos de 0,35 m. */
export function rumoAoAlvo(e: EstadoPessoa, alvo: Ponto2D, dt: number): { yaw: number; entrada: Entrada; chegou: boolean } {
  const dx = alvo.x - e.x;
  const dz = alvo.z - e.z;
  if (Math.hypot(dx, dz) < 0.35) return { yaw: e.yaw, entrada: { frente: 0, lado: 0 }, chegou: true };
  const falta = diferencaAngulo(e.yaw, yawPara(dx, dz));
  const yaw = e.yaw + falta * Math.min(1, dt * 6);
  return { yaw, entrada: { frente: Math.abs(falta) < 0.6 ? 1 : 0, lado: 0 }, chegou: false };
}

/** Controle de videogame: alavanca esquerda anda, direita olha; zona morta para o controle parado não andar sozinho. */
export function entradaDoControle(eixos: readonly number[], zonaMorta = 0.15): { andar: Entrada; girar: number; inclinar: number } {
  const z = (v: number | undefined) => (v === undefined || Math.abs(v) < zonaMorta ? 0 : (v - Math.sign(v) * zonaMorta) / (1 - zonaMorta));
  return { andar: { frente: -z(eixos[1]) || 0, lado: z(eixos[0]) }, girar: z(eixos[2]), inclinar: z(eixos[3]) };
}

/** Deslocamento do dedo no joystick (px) → entrada. Para cima = frente. Limitado ao círculo, zona morta de 10%. */
export function vetorJoystick(dx: number, dy: number, raio: number): Entrada {
  const tamanho = Math.hypot(dx, dy) / raio;
  if (tamanho < 0.1) return { frente: 0, lado: 0 };
  const escala = tamanho > 1 ? 1 / tamanho : 1;
  return { frente: (-dy / raio) * escala, lado: (dx / raio) * escala };
}
