import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { localParaLonLat } from './lotes.teste-ajuda';
import { COR_LOTE, criarLotes, type LoteViewer } from './lotes';

const centro = { lon: -46.65, lat: -23.56 };
// 3 lotes de 12 × 30 m lado a lado (quadra 01) e 1 na quadra 02
const lote = (id: string, quadra: string, x: number, status: LoteViewer['status'] = 'disponivel'): LoteViewer => ({
  id,
  quadra,
  numero: id,
  status,
  contorno: [localParaLonLat(centro, x, 0), localParaLonLat(centro, x + 12, 0), localParaLonLat(centro, x + 12, -30), localParaLonLat(centro, x, -30)],
});

describe('lotes no chão', () => {
  const lotes = [lote('a', '01', 0), lote('b', '01', 12, 'reservado'), lote('c', '01', 24, 'vendido'), lote('d', '02', 100)];
  const l = criarLotes(lotes, centro, 0);

  it('uma malha só, 2 triângulos por lote retangular, cor da situação em cada vértice', () => {
    expect(l.preenchimento.geometry.getAttribute('position').count).toBe(4 * 6);
    const cor = l.preenchimento.geometry.getAttribute('color');
    const hex = (i: number) => ((Math.round(cor.getX(i) * 255) << 16) | (Math.round(cor.getY(i) * 255) << 8) | Math.round(cor.getZ(i) * 255)) >>> 0;
    const c = (h: number) => {
      const t = new THREE.Color(h);
      return ((Math.round(t.r * 255) << 16) | (Math.round(t.g * 255) << 8) | Math.round(t.b * 255)) >>> 0;
    };
    expect(hex(0)).toBe(c(COR_LOTE.disponivel));
    expect(hex(6)).toBe(c(COR_LOTE.reservado));
    expect(hex(12)).toBe(c(COR_LOTE.vendido));
  });

  it('o triângulo tocado diz o lote; centros de lote e de quadra no lugar certo', () => {
    expect([0, 1, 2, 3, 4, 7, 8].map((f) => l.idDoTriangulo(f))).toEqual(['a', 'a', 'b', 'b', 'c', 'd', null]);
    expect(l.centros.get('b')!.x).toBeCloseTo(18, 0);
    expect(Math.abs(l.centros.get('b')!.z)).toBeCloseTo(15, 0);
    expect(l.quadras.get('01')!.x).toBeCloseTo(18, 0);
    expect(l.caixa.maxX).toBeCloseTo(112, 0);
  });

  it('repinta pela situação e apaga quem não passou no filtro', () => {
    const cor = l.preenchimento.geometry.getAttribute('color');
    l.pintar(new Map([['a', 'vendido']]), new Set(['a']));
    const vermelho = cor.getX(0);
    expect(vermelho).toBeGreaterThan(cor.getZ(0)); // a ficou vermelha
    const apagado = Math.max(cor.getX(18), cor.getY(18), cor.getZ(18));
    expect(apagado).toBeLessThan(0.35); // d (fora do filtro) quase some
  });
});
