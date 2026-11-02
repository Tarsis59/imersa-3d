import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { construirCasaModelo, footprintConstrutivo, RECUOS_CASA_MODELO } from './casaModelo';

// lote de 12 × 30 m: x de 0 a 12 (frente, lado curto, à margem da rua em z = 0), z de 0 a 30 (profundidade, para
// dentro do lote); a rua fica ao sul (−z), por isso a frente olha para −z
const LOTE = [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 30 }, { x: 0, z: 30 }];
const centro = { x: 6, z: 15 };
const frenteNormal = { x: 0, z: -1 }; // frente para o sul

describe('footprint construtivo da casa-modelo (Plano 12d, item 9)', () => {
  it('tira os recuos (frente 5, lateral 1,5, fundo 3) das medidas do lote', () => {
    const f = footprintConstrutivo(LOTE, centro, frenteNormal)!;
    expect(f).not.toBeNull();
    // lateral (frente, 12 m): 12 - 2*1,5 = 9; profundidade (frente → fundo, 30 m): 30 - 5 - 3 = 22
    expect(f.largura).toBeCloseTo(9, 6);
    expect(f.profundidade).toBeCloseTo(22, 6);
  });

  it('a casa fica virada para a frente e deslocada para dentro do lote pelos recuos', () => {
    const f = footprintConstrutivo(LOTE, centro, frenteNormal)!;
    // o eixo da profundidade é z (frente ao sul, fundo ao norte); a casa desloca para dentro (longe da rua, +z)
    expect(f.cz).toBeGreaterThan(centro.z); // recuo de frente (5) > recuo de fundo (3): desloca mais para dentro
    expect(f.cx).toBeCloseTo(centro.x, 6); // lateral (x) continua centrado
    // ângulo: frenteNormal = (0,-1) → atan2(0,-1) = 180°
    expect(f.anguloGraus).toBeCloseTo(180, 6);
  });

  it('recuos configuráveis: menos recuo dá mais área construída', () => {
    const padrao = footprintConstrutivo(LOTE, centro, frenteNormal, RECUOS_CASA_MODELO)!;
    const menorRecuo = footprintConstrutivo(LOTE, centro, frenteNormal, { frenteM: 2, lateralM: 1, fundoM: 1 })!;
    expect(menorRecuo.largura).toBeGreaterThan(padrao.largura);
    expect(menorRecuo.profundidade).toBeGreaterThan(padrao.profundidade);
  });

  it('lote pequeno demais para os recuos: null', () => {
    const minilote = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 4 }, { x: 0, z: 4 }];
    expect(footprintConstrutivo(minilote, { x: 1.5, z: 2 }, { x: 1, z: 0 })).toBeNull();
  });

  it('sem normal (frente) válida: null', () => {
    expect(footprintConstrutivo(LOTE, centro, { x: 0, z: 0 })).toBeNull();
  });
});

describe('construção da casa-modelo no 3D', () => {
  it('monta paredes, telhado, porta e janelas, virada e no lugar certo', () => {
    const f = footprintConstrutivo(LOTE, centro, frenteNormal)!;
    const casa = construirCasaModelo(f, () => 0, () => undefined);
    expect(casa.objeto.position.x).toBeCloseTo(f.cx, 6);
    expect(casa.objeto.position.z).toBeCloseTo(f.cz, 6);
    expect(casa.objeto.rotation.y).toBeCloseTo((f.anguloGraus * Math.PI) / 180, 6);
    const malhas = casa.objeto.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    // paredes + telhado + porta + 2 janelas (lote largo o bastante)
    expect(malhas.length).toBe(5);
    casa.destruir();
  });

  it('lote estreito: só a porta, sem janelas (não cabe)', () => {
    const f = { cx: 0, cz: 0, anguloGraus: 0, largura: 2.5, profundidade: 10 };
    const casa = construirCasaModelo(f, () => 0, () => undefined);
    const malhas = casa.objeto.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(malhas.length).toBe(3); // paredes + telhado + porta
    casa.destruir();
  });
});
