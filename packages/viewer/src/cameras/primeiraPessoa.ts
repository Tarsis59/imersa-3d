import type { Caixa } from '../units/tipos';

export interface EstadoPessoa {
  x: number;
  z: number;
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
  const de = { x: e.x, z: e.z };
  const candidatos = [
    { x: e.x + dx, z: e.z + dz },
    { x: e.x + dx, z: e.z },
    { x: e.x, z: e.z + dz },
  ];
  for (const c of candidatos) if (!o.bloqueado(de, c)) return { ...c, yaw: e.yaw };
  return e;
}

/**
 * Bloqueio contra caixas (volumes do prédio): o corpo é um cilindro de `raio`, dos pés (olhos − 1,5 m + 0,3 m de degrau)
 * até os olhos. Caixa acima da cabeça ou abaixo dos pés não bloqueia. Confere o caminho inteiro, não só o ponto final:
 * com FPS baixo o passo fica grande e atravessaria paredes finas.
 */
export function bloqueioPorCaixas(caixas: readonly Caixa[], raio: number, alturaOlhos: number): OpcoesPasso['bloqueado'] {
  const pes = alturaOlhos - 1.5 + 0.3;
  const altura = caixas.filter((c) => c.maxY > pes && c.minY < alturaOlhos);
  const dentro = (p: Ponto2D) => altura.some((c) => p.x > c.minX - raio && p.x < c.maxX + raio && p.z > c.minZ - raio && p.z < c.maxZ + raio);
  return (de, para) => {
    const amostras = Math.max(1, Math.ceil(Math.hypot(para.x - de.x, para.z - de.z) / (raio / 2)));
    for (let i = 1; i <= amostras; i++) {
      const t = i / amostras;
      if (dentro({ x: de.x + (para.x - de.x) * t, z: de.z + (para.z - de.z) * t })) return true;
    }
    return false;
  };
}

/** Deslocamento do dedo no joystick (px) → entrada. Para cima = frente. Limitado ao círculo, zona morta de 10%. */
export function vetorJoystick(dx: number, dy: number, raio: number): Entrada {
  const tamanho = Math.hypot(dx, dy) / raio;
  if (tamanho < 0.1) return { frente: 0, lado: 0 };
  const escala = tamanho > 1 ? 1 / tamanho : 1;
  return { frente: (-dy / raio) * escala, lado: (dx / raio) * escala };
}
