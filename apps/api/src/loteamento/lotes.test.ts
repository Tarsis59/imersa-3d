import { describe, expect, it } from 'vitest';
import { lerDxf } from './dxf';
import { areaPoligono, frenteFundo, lotesDoDxf, lotesDoGeoJson, numeroLimpo } from './lotes';
import { utmParaLatLon } from './utm';

/** DXF de texto como o AutoCAD exporta: polilinhas leves (LWPOLYLINE) e textos, com layers. */
function dxf(entidades: string[]): string {
  return ['0', 'SECTION', '2', 'HEADER', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...entidades, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}
const poli = (camada: string, pts: Array<[number, number]>, fechada = true) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', fechada ? '1' : '0', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])].join('\n');
const texto = (camada: string, x: number, y: number, t: string) => ['0', 'TEXT', '8', camada, '10', String(x), '20', String(y), '40', '1.5', '1', t].join('\n');

// 2 quadras em UTM (fuso 23, perto de São Paulo), cada uma com 3 lotes de 12 × 30 m lado a lado
const X0 = 333_000;
const Y0 = 7_394_000;
function quadra(q: number, dy: number): string[] {
  const out = [poli('QUADRAS', [[X0 - 2, Y0 + dy - 2], [X0 + 38, Y0 + dy - 2], [X0 + 38, Y0 + dy + 32], [X0 - 2, Y0 + dy + 32]]), texto('QUADRAS', X0 + 30, Y0 + dy + 31, `Q-${String(q).padStart(2, '0')}`)];
  for (let l = 0; l < 3; l++) {
    const x = X0 + l * 12;
    out.push(poli('LOTES', [[x, Y0 + dy], [x + 12, Y0 + dy], [x + 12, Y0 + dy + 30], [x, Y0 + dy + 30]]), texto('NUMEROS', x + 6, Y0 + dy + 15, String(l + 1)));
  }
  return out;
}

describe('DXF do parcelamento → lotes', () => {
  it('lê polilinhas leves e antigas (VERTEX/SEQEND), textos e MTEXT com formatação', () => {
    const antiga = ['0', 'POLYLINE', '8', 'LOTES', '70', '1', '0', 'VERTEX', '8', 'LOTES', '10', '0', '20', '0', '0', 'VERTEX', '8', 'LOTES', '10', '10', '20', '0', '0', 'VERTEX', '8', 'LOTES', '10', '10', '20', '10', '0', 'SEQEND'].join('\n');
    const mtext = ['0', 'MTEXT', '8', 'NUMEROS', '10', '5', '20', '5', '1', '{\\fArial|b0;\\P12}'].join('\n');
    const d = lerDxf(dxf([antiga, mtext, poli('RUAS', [[0, 0], [5, 5]], false)]));
    // RUAS (item 8): traço de 2 pontos só, sem fechar — continua lido (ruas e calçadas são linhas abertas)
    expect(d.polilinhas.map((p) => [p.camada, p.fechada, p.pontos.length])).toEqual([['LOTES', true, 3], ['RUAS', false, 2]]);
    expect(d.textos).toEqual([{ camada: 'NUMEROS', x: 5, y: 5, texto: '12' }]);
    expect(() => lerDxf('isto não é dxf\nnada')).toThrow('dxf_invalido');
  });

  it('6 lotes em 2 quadras, com área, frente × fundo e o contorno em lon/lat perto de São Paulo', () => {
    const r = lotesDoDxf(lerDxf(dxf([...quadra(1, 0), ...quadra(2, 50)])), { fuso: 23 });
    expect(r.avisos).toEqual([]);
    expect(r.lotes.map((l) => `${l.quadra}-${l.numero}`)).toEqual(['01-01', '01-02', '01-03', '02-01', '02-02', '02-03']);
    for (const l of r.lotes) expect([l.areaM2, l.frenteM, l.fundoM]).toEqual([360, 12, 30]);
    const [lon, lat] = r.lotes[0]!.contorno[0]!;
    expect(lat).toBeGreaterThan(-23.6);
    expect(lat).toBeLessThan(-23.5);
    expect(lon).toBeGreaterThan(-46.7);
    expect(lon).toBeLessThan(-46.6);
  });

  it('avisa o que ficou de fora: sem número, fora de quadra, repetido; metros sem fuso', () => {
    const semNumero = poli('LOTES', [[X0 + 100, Y0], [X0 + 112, Y0], [X0 + 112, Y0 + 30], [X0 + 100, Y0 + 30]]);
    const r = lotesDoDxf(lerDxf(dxf([...quadra(1, 0), semNumero, texto('NUMEROS', X0 + 106, Y0 + 15, '9')])), { fuso: 23 });
    expect(r.lotes).toHaveLength(3);
    expect(r.avisos).toEqual(['Lote 09 fora de uma quadra com nome (ficou de fora).']);
    const repetido = lotesDoDxf(lerDxf(dxf([...quadra(1, 0), poli('LOTES', [[X0, Y0], [X0 + 12, Y0], [X0 + 12, Y0 + 30], [X0, Y0 + 30]])])), { fuso: 23 });
    expect(repetido.avisos.some((a) => a.includes('aparece duas vezes'))).toBe(true);
    expect(lotesDoDxf(lerDxf(dxf(quadra(1, 0)))).avisos[0]).toMatch(/informe o fuso/);
    expect(lotesDoDxf(lerDxf(dxf([texto('X', 0, 0, 'nada')]))).avisos[0]).toMatch(/Nenhuma polilinha/);
  });

  it('números e medidas', () => {
    expect(['Q-04', 'QUADRA 4', 'Qd 04', 'L12', 'LOTE 12', '7A', 'rua'].map(numeroLimpo)).toEqual(['04', '04', '04', '12', '12', '7A', null]);
    expect(areaPoligono([[0, 0], [10, 0], [10, 20], [0, 20]])).toBe(200);
    // lote girado 30°: o menor retângulo acha as medidas reais
    const g = (x: number, y: number): [number, number] => [x * Math.cos(0.52) - y * Math.sin(0.52), x * Math.sin(0.52) + y * Math.cos(0.52)];
    const ff = frenteFundo([g(0, 0), g(10, 0), g(10, 25), g(0, 25)]);
    expect(ff.frente).toBeCloseTo(10, 6);
    expect(ff.fundo).toBeCloseTo(25, 6);
  });

  it('UTM SIRGAS 2000: no meridiano central e no Equador, valores conhecidos', () => {
    const eq = utmParaLatLon(500_000, 10_000_000, 23);
    expect(eq.lat).toBeCloseTo(0, 6);
    expect(eq.lon).toBeCloseTo(-45, 6);
    const sp = utmParaLatLon(500_000, 7_400_000, 23);
    expect(sp.lon).toBeCloseTo(-45, 6);
    expect(sp.lat).toBeCloseTo(-23.5126, 2);
    // simétrico em volta do meridiano central
    expect(utmParaLatLon(400_000, 7_400_000, 23).lon + 45).toBeCloseTo(-(utmParaLatLon(600_000, 7_400_000, 23).lon + 45), 6);
  });
});

describe('GeoJSON do QGIS → lotes', () => {
  const feicao = (quadra: string, lote: string, extra: Record<string, unknown> = {}) => ({
    type: 'Feature',
    properties: { quadra, lote, ...extra },
    geometry: { type: 'Polygon', coordinates: [[[-46.65, -23.56], [-46.6499, -23.56], [-46.6499, -23.5597], [-46.65, -23.5597], [-46.65, -23.56]]] },
  });
  it('lê quadra, lote, preço e situação; confere a área informada', () => {
    const r = lotesDoGeoJson({ type: 'FeatureCollection', features: [feicao('4', '12', { preco: 250000, status: 'reservado', area_m2: 340 }), feicao('4', '13', { area_m2: 500 }), feicao('', 'x')] });
    expect(r.lotes.map((l) => [l.quadra, l.numero, l.preco, l.status])).toEqual([
      ['04', '12', 250000, 'reservado'],
      ['04', '13', undefined, undefined],
    ]);
    expect(r.lotes[0]!.areaM2).toBeGreaterThan(330);
    expect(r.lotes[0]!.areaM2).toBeLessThan(350);
    expect(r.avisos).toEqual([expect.stringMatching(/Lote 13 da quadra 04: área do desenho .* difere da informada 500/), 'Feição 3 sem polígono, quadra ou lote (ficou de fora).']);
    expect(lotesDoGeoJson({}).avisos).toEqual(['GeoJSON sem "features".']);
  });
});
