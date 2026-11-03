import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { localParaLonLat } from './lotes.teste-ajuda';
import { COR_LOTE, criarLotes, DETALHE_VARREDURA, distanciaDaVista, type LoteViewer } from './lotes';

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

  it('varredura em ciano (Plano 12d, item 4): só os lotes do filtro ganham a marca "aPassou" para acender', () => {
    const passou = l.preenchimento.geometry.getAttribute('aPassou');
    // sem filtro: todo mundo passa
    l.pintar(new Map(), null);
    expect([passou.getX(0), passou.getX(6), passou.getX(18)]).toEqual([1, 1, 1]);
    // só "a" e "b" passam: "c" e "d" ficam de fora (não acendem na varredura)
    l.pintar(new Map(), new Set(['a', 'b']));
    expect([passou.getX(0), passou.getX(6), passou.getX(12), passou.getX(18)]).toEqual([1, 1, 0, 0]);
    // liga/avança/desliga sem lançar erro (o uniform em si só é lido pelo WebGL no desenho real)
    expect(() => {
      l.definirVarredura(true, 0);
      l.definirVarredura(true, 0.5);
      l.definirVarredura(true, 1);
      l.definirVarredura(false, 1);
    }).not.toThrow();
  });

  it('"Ver daqui" (Plano 12d, item 11): ponto fora do maior lado do lote, olhando para o centro dele', () => {
    const v = l.vistas.get('b')!;
    expect(v).toBeDefined();
    // lote "b": x de 12 a 24, z de 0 a -30 — o lado mais longo (30 m) é o de x = 24; 25 m para fora dele é x ≈ 49
    expect(v.x).toBeCloseTo(49, 0);
    expect(v.z).toBeCloseTo(-15, 0);
    expect(v.alvoX).toBeCloseTo(18, 0);
    expect(v.alvoZ).toBeCloseTo(-15, 0);
  });

  it('"Ver daqui": a distância cresce com a frente, de 3 m (frente estreita) a 25 m (frente larga)', () => {
    expect(distanciaDaVista(5)).toBe(3);
    expect(distanciaDaVista(12)).toBeCloseTo(9.4, 5);
    expect(distanciaDaVista(30)).toBe(25);
  });

  it('footprint da casa-modelo (Plano 12d, item 9): o retângulo construtivo do lote, com os recuos', () => {
    // lote "b": x de 12 a 24, z de 0 a -30; a frente detectada (item 11) é o lado x = 24, normal (1, 0)
    const f = l.footprint('b');
    expect(f).not.toBeNull();
    expect(f!.largura).toBeCloseTo(30 - 2 * 1.5, 0); // lateral = a extensão em z (30 m) menos os recuos laterais
    expect(f!.profundidade).toBeCloseTo(12 - 5 - 3, 0); // profundidade = a extensão em x (12 m) menos frente/fundo
    expect(l.footprint('inexistente')).toBeNull();
  });

  it('DETALHE_VARREDURA é o interruptor da qualidade baixa (objeto único, mutável por fora)', () => {
    expect(DETALHE_VARREDURA.value).toBe(1);
    DETALHE_VARREDURA.value = 0;
    expect(DETALHE_VARREDURA.value).toBe(0);
    DETALHE_VARREDURA.value = 1; // devolve o padrão para não vazar entre testes
  });
});
