import { describe, it, expect } from 'vitest';
import { passoPrimeiraPessoa, bloqueioPorCaixas, vetorJoystick, seguirPiso, rumoAoAlvo, yawPara, diferencaAngulo, entradaDoControle } from './primeiraPessoa';

const livre = () => false;

describe('primeira pessoa', () => {
  it('anda para onde olha: yaw 0 = norte (−z), yaw 90° = oeste (−x)', () => {
    const a = passoPrimeiraPessoa({ x: 0, z: 0, yaw: 0 }, { frente: 1, lado: 0 }, 1, { velocidade: 2, bloqueado: livre });
    expect(a.x).toBeCloseTo(0);
    expect(a.z).toBeCloseTo(-2);
    const b = passoPrimeiraPessoa({ x: 0, z: 0, yaw: Math.PI / 2 }, { frente: 1, lado: 0 }, 1, { velocidade: 2, bloqueado: livre });
    expect(b.x).toBeCloseTo(-2);
    expect(b.z).toBeCloseTo(0);
  });

  it('lado direito com yaw 0 = leste (+x); para trás = sul', () => {
    const a = passoPrimeiraPessoa({ x: 0, z: 0, yaw: 0 }, { frente: -1, lado: 1 }, 1, { velocidade: 1, bloqueado: livre });
    expect(a.x).toBeGreaterThan(0);
    expect(a.z).toBeGreaterThan(0);
  });

  it('na diagonal não fica mais rápido', () => {
    const a = passoPrimeiraPessoa({ x: 0, z: 0, yaw: 0 }, { frente: 1, lado: 1 }, 1, { velocidade: 2, bloqueado: livre });
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(2);
  });

  it('parede bloqueia; andando na diagonal desliza ao longo dela', () => {
    // parede ao norte, de z = -1,5 a -1 (lado de dentro em z = -1)
    const parede = bloqueioPorCaixas([{ minX: -50, maxX: 50, minY: 0, maxY: 3, minZ: -1.5, maxZ: -1 }], 0.3, 1.6);
    const reto = passoPrimeiraPessoa({ x: 0, z: 0, yaw: 0 }, { frente: 1, lado: 0 }, 1, { velocidade: 2, bloqueado: parede });
    expect(reto.z).toBe(0);
    const diag = passoPrimeiraPessoa({ x: 0, z: 0, yaw: 0 }, { frente: 1, lado: 1 }, 1, { velocidade: 2, bloqueado: parede });
    expect(diag.z).toBe(0);
    expect(diag.x).toBeCloseTo(Math.SQRT2);
  });

  it('passo grande (FPS baixo) não atravessa parede fina', () => {
    const fina = bloqueioPorCaixas([{ minX: -50, maxX: 50, minY: 0, maxY: 3, minZ: -2.05, maxZ: -2 }], 0.3, 1.6);
    const p = passoPrimeiraPessoa({ x: 0, z: 0, yaw: 0 }, { frente: 1, lado: 0 }, 1, { velocidade: 5, bloqueado: fina });
    expect(p.z).toBe(0);
  });

  it('caixa acima da cabeça ou abaixo dos pés não bloqueia', () => {
    const alto = bloqueioPorCaixas([{ minX: -5, maxX: 5, minY: 5, maxY: 8, minZ: -5, maxZ: 5 }], 0.3, 1.6);
    const chao = bloqueioPorCaixas([{ minX: -5, maxX: 5, minY: -1, maxY: 0, minZ: -5, maxZ: 5 }], 0.3, 1.6);
    expect(alto({ x: 0, z: 1 }, { x: 0, z: 0 })).toBe(false);
    expect(chao({ x: 0, z: 1 }, { x: 0, z: 0 })).toBe(false);
  });

  it('dt zero ou entrada zero não move', () => {
    const e = { x: 3, z: 4, yaw: 1 };
    expect(passoPrimeiraPessoa(e, { frente: 1, lado: 0 }, 0, { velocidade: 2, bloqueado: livre })).toEqual(e);
    expect(passoPrimeiraPessoa(e, { frente: 0, lado: 0 }, 1, { velocidade: 2, bloqueado: livre })).toEqual(e);
  });
});

describe('joystick de toque', () => {
  it('para cima = frente, direita = lado; limitado ao círculo', () => {
    expect(vetorJoystick(0, -40, 40)).toEqual({ frente: 1, lado: 0 });
    const meio = vetorJoystick(20, 0, 40);
    expect(meio.frente).toBeCloseTo(0);
    expect(meio.lado).toBeCloseTo(0.5);
    const fora = vetorJoystick(400, -400, 40);
    expect(Math.hypot(fora.frente, fora.lado)).toBeCloseTo(1);
  });

  it('zona morta de 10%', () => {
    expect(vetorJoystick(3, 2, 40)).toEqual({ frente: 0, lado: 0 });
  });
});

describe('andar de verdade (pisos, apartamento, tocar para ir, controle)', () => {
  it('dentro de um apartamento (caixa) anda livre, mas não atravessa a parede para sair', () => {
    const apto = bloqueioPorCaixas([{ minX: 0, maxX: 8, minY: 3, maxY: 6, minZ: 0, maxZ: 8 }], 0.3, 1.6);
    expect(apto({ x: 4, z: 4, y: 3 }, { x: 6, z: 4, y: 3 })).toBe(false);
    expect(apto({ x: 4, z: 4, y: 3 }, { x: 9, z: 4, y: 3 })).toBe(true);
    // no térreo, a caixa do 2º andar está acima da cabeça: não bloqueia
    expect(apto({ x: -2, z: 4, y: 0 }, { x: 4, z: 4, y: 0 })).toBe(false);
  });

  it('o passo mantém a altura dos pés', () => {
    const r = passoPrimeiraPessoa({ x: 0, z: 0, y: 6, yaw: 0 }, { frente: 1, lado: 0 }, 1, { velocidade: 1, bloqueado: () => false });
    expect(r.y).toBe(6);
  });

  it('segue o piso: sobe degrau, desce, e sem piso fica onde está', () => {
    const escada = (x: number) => Math.min(3, Math.floor(Math.max(0, x)) * 0.18); // degraus de 18 cm até 3 m
    const pisoEm = (x: number, _z: number, deY: number) => {
      const h = escada(x);
      return h <= deY ? h : 0;
    };
    let y = 0;
    for (let x = 0; x <= 20; x += 0.5) y = seguirPiso(y, x, 0, pisoEm);
    expect(y).toBeCloseTo(3, 5);
    expect(seguirPiso(3, 0, 0, pisoEm)).toBe(0); // desce
    expect(seguirPiso(2, 0, 0, () => null)).toBe(2);
  });

  it('tocar para ir: vira primeiro, depois anda, e para ao chegar', () => {
    const e = { x: 0, z: 0, yaw: 0 };
    const deLado = rumoAoAlvo(e, { x: 10, z: 0 }, 0.016); // alvo a leste, olhando para o norte
    expect(deLado.entrada.frente).toBe(0);
    expect(deLado.yaw).toBeLessThan(0); // gira para a direita (leste)
    const deFrente = rumoAoAlvo({ ...e, yaw: yawPara(10, 0) }, { x: 10, z: 0 }, 0.016);
    expect(deFrente.entrada.frente).toBe(1);
    expect(rumoAoAlvo({ x: 9.8, z: 0, yaw: 0 }, { x: 10, z: 0 }, 0.016).chegou).toBe(true);
    expect(Math.abs(diferencaAngulo(3.1, -3.1))).toBeLessThan(0.1); // menor caminho
  });

  it('controle: alavancas com zona morta; para cima anda para a frente', () => {
    expect(entradaDoControle([0.1, -0.1, 0.05, 0])).toEqual({ andar: { frente: 0, lado: 0 }, girar: 0, inclinar: 0 });
    const c = entradaDoControle([1, -1, -1, 0.5]);
    expect(c.andar).toEqual({ frente: 1, lado: 1 });
    expect(c.girar).toBe(-1);
    expect(c.inclinar).toBeGreaterThan(0.3);
  });
});
