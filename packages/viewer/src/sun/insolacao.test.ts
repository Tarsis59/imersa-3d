import { describe, it, expect } from 'vitest';
import { estudoSolar, horasDeSol, raioBloqueado, type FaceSolar } from './insolacao';
import { horaSaoPauloParaUtc, sunDirection } from './sun';

// São Paulo (Av. Paulista), modelo sem rotação: x = leste, z = sul (como o sol do viewer)
const LAT = -23.56175;
const LON = -46.6545;
const solSP = (data: string, hora: number) => {
  const v = sunDirection(horaSaoPauloParaUtc(data, hora), LAT, LON);
  return { x: v.x, y: v.y, z: v.z };
};
const face = (nx: number, nz: number): FaceSolar => ({ centro: { x: 0, y: 10, z: 0 }, normal: { x: nx, z: nz } });
const NORTE = face(0, -1);
const SUL = face(0, 1);
const LESTE = face(1, 0);
const OESTE = face(-1, 0);

describe('estudo solar (horas de sol direto na fachada)', () => {
  it('raio contra caixa: bate só no que está no caminho e à frente', () => {
    const muro = { minX: 5, maxX: 6, minY: 0, maxY: 20, minZ: -5, maxZ: 5 };
    expect(raioBloqueado({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, [muro])).toBe(true);
    expect(raioBloqueado({ x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, [muro])).toBe(false);
    expect(raioBloqueado({ x: 0, y: 30, z: 0 }, { x: 1, y: 0, z: 0 }, [muro])).toBe(false);
  });

  it('em São Paulo, a fachada norte tem sol no inverno e a sul quase nenhum', () => {
    const norte = estudoSolar(NORTE, [], solSP, true);
    const sul = estudoSolar(SUL, [], solSP, true);
    expect(norte.inverno).toBeGreaterThanOrEqual(8);
    expect(sul.inverno).toBe(0);
    // no verão o sol passa ao sul do zênite de manhã cedo e no fim da tarde: a fachada sul ganha algumas horas
    expect(sul.verao).toBeGreaterThan(0);
  });

  it('leste é sol da manhã; oeste, sol da tarde', () => {
    expect(estudoSolar(LESTE, [], solSP, true).periodo).toBe('manha');
    expect(estudoSolar(OESTE, [], solSP, true).periodo).toBe('tarde');
    expect(estudoSolar(NORTE, [], solSP, true).periodo).toBe('dia-todo');
  });

  it('um prédio alto bem na frente tira o sol', () => {
    const vizinho = { minX: -30, maxX: 30, minY: 0, maxY: 120, minZ: -25, maxZ: -15 }; // ao norte, colado
    const livre = horasDeSol(NORTE, [], solSP, '2026-06-21');
    const tapada = horasDeSol(NORTE, [vizinho], solSP, '2026-06-21');
    expect(livre.total).toBeGreaterThan(8);
    expect(tapada.total).toBeLessThan(1);
    // no equinócio o sol baixo da manhã e da tarde ainda entra pelas laterais do vizinho (que tem largura finita)
    const ano = estudoSolar(NORTE, [vizinho], solSP, true);
    expect(ano.equinocio).toBeLessThan(estudoSolar(NORTE, [], solSP, true).equinocio);
    expect(estudoSolar(NORTE, [{ ...vizinho, minX: -400, maxX: 400 }], solSP, true).periodo).toBe('pouco-sol');
  });

  it('horas em meias horas e nunca acima da duração do dia', () => {
    const e = estudoSolar(NORTE, [], solSP, true);
    for (const h of [e.verao, e.inverno, e.equinocio]) {
      expect(Number.isInteger(h * 2)).toBe(true);
      expect(h).toBeLessThanOrEqual(14);
    }
  });
});
