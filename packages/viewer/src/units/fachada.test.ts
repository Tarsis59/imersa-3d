import { describe, it, expect } from 'vitest';
import { massaDoPredio } from './massa';
import { ladoExterno, planejarFachada } from './fachada';
import type { Caixa } from './tipos';

const sobrepoe = (a: Caixa, b: Caixa) => a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minY < b.maxY - 1e-6 && a.maxY > b.minY + 1e-6 && a.minZ < b.maxZ - 1e-6 && a.maxZ > b.minZ + 1e-6;

/** Térreo + 4 andares com 4 unidades (2×2). */
const predio = () => massaDoPredio([0, 1, 2, 3, 4].map((numero) => ({ numero, unidades: [0, 1, 2, 3].map((i) => `${numero}-${i}`) })));

describe('fachada procedural', () => {
  it('uma laje por andar mais a cobertura, com beiral para fora das unidades', () => {
    const caixas = predio();
    const pecas = planejarFachada(caixas.values());
    const lajes = pecas.filter((p) => p.tipo === 'laje');
    expect(lajes).toHaveLength(6);
    const unidades = [...caixas.values()];
    const minX = Math.min(...unidades.map((u) => u.minX));
    for (const l of lajes) expect(l.caixa.minX).toBeLessThan(minX);
  });

  it('nenhuma peça entra no volume de uma unidade (a unidade continua clicável e visível)', () => {
    const caixas = predio();
    const unidades = [...caixas.values()];
    for (const p of planejarFachada(unidades)) for (const u of unidades) expect(sobrepoe(p.caixa, u), `${p.tipo} dentro de unidade`).toBe(false);
  });

  it('varanda com guarda-corpo em cada unidade dos andares de cima, para fora do prédio; térreo com marquise', () => {
    const caixas = predio();
    const pecas = planejarFachada(caixas.values());
    expect(pecas.filter((p) => p.tipo === 'varanda')).toHaveLength(16); // 4 andares × 4 unidades
    expect(pecas.filter((p) => p.tipo === 'guarda-corpo')).toHaveLength(48); // frente + 2 laterais
    expect(pecas.filter((p) => p.tipo === 'marquise')).toHaveLength(1);
    const unidades = [...caixas.values()];
    const minZ = Math.min(...unidades.map((u) => u.minZ));
    const maxZ = Math.max(...unidades.map((u) => u.maxZ));
    for (const v of pecas.filter((p) => p.tipo === 'varanda')) expect(v.caixa.minZ >= maxZ - 1e-6 || v.caixa.maxZ <= minZ + 1e-6).toBe(true);
  });

  it('cobertura: platibanda nos 4 lados e casa de máquinas acima da última laje', () => {
    const pecas = planejarFachada(predio().values());
    const plat = pecas.filter((p) => p.tipo === 'platibanda');
    expect(plat).toHaveLength(4);
    const casa = pecas.find((p) => p.tipo === 'casa-de-maquinas')!;
    expect(casa.caixa.minY).toBeGreaterThanOrEqual(15);
    for (const p of plat) expect(p.caixa.maxY - p.caixa.minY).toBeCloseTo(1, 5);
  });

  it('lado externo: unidade do meio de uma fileira usa a frente; unidade cercada não tem varanda', () => {
    const caixas = [...massaDoPredio([{ numero: 1, unidades: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }]).values()]; // 3×3
    const meio = caixas[4]!;
    expect(ladoExterno(meio, caixas)).toBeNull();
    expect(ladoExterno(caixas[7]!, caixas)).toBe('+z');
    expect(ladoExterno(caixas[1]!, caixas)).toBe('-z');
    expect(ladoExterno(caixas[3]!, caixas)).toBe('-x');
  });

  it('prédio vazio não gera nada', () => {
    expect(planejarFachada([])).toEqual([]);
  });
});
