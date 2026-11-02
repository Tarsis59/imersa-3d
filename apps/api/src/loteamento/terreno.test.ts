import { describe, expect, it } from 'vitest';
import { lerDxf } from './dxf';
import { terrenoDoDxf } from './terreno';

function dxf(entidades: string[]): string {
  return ['0', 'SECTION', '2', 'ENTITIES', ...entidades, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}
const poli = (camada: string, pts: Array<[number, number]>, fechada = false, elevacao?: number) => [
  '0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', fechada ? '1' : '0',
  ...(elevacao !== undefined ? ['38', String(elevacao)] : []),
  ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)]),
].join('\n');

const X0 = 333_000;
const Y0 = 7_394_000;

describe('terreno e infraestrutura do loteamento (Plano 12d, item 8)', () => {
  it('lê ruas, calçadas, meio-fio e curvas de nível com a cota (código 38), convertendo para lon/lat', () => {
    const d = lerDxf(
      dxf([
        poli('RUAS', [[X0, Y0], [X0 + 100, Y0]]),
        poli('CALCADAS', [[X0, Y0 + 3], [X0 + 100, Y0 + 3]]),
        poli('MEIO_FIO', [[X0, Y0 + 2.5], [X0 + 100, Y0 + 2.5]]),
        poli('CURVAS_NIVEL', [[X0, Y0 - 10], [X0 + 100, Y0 - 10]], false, 742.5),
      ]),
    );
    const t = terrenoDoDxf(d, { fuso: 23 });
    expect(t.avisos).toEqual([]);
    expect(t.ruas).toHaveLength(1);
    expect(t.calcadas).toHaveLength(1);
    expect(t.meioFio).toHaveLength(1);
    expect(t.curvas).toEqual([{ pontos: expect.any(Array), elevacaoM: 742.5 }]);
    const [lon, lat] = t.ruas[0]![0]!;
    expect(lat).toBeGreaterThan(-23.6);
    expect(lat).toBeLessThan(-23.5);
    expect(lon).toBeGreaterThan(-46.7);
    expect(lon).toBeLessThan(-46.6);
  });

  it('aceita os nomes comuns dos layers: VIAS, SISTEMA_VIARIO, PASSEIO, GUIA, CN', () => {
    const d = lerDxf(
      dxf([
        poli('VIAS', [[X0, Y0], [X0 + 10, Y0]]),
        poli('SISTEMA_VIARIO', [[X0, Y0 + 1], [X0 + 10, Y0 + 1]]),
        poli('PASSEIO', [[X0, Y0 + 2], [X0 + 10, Y0 + 2]]),
        poli('GUIA', [[X0, Y0 + 3], [X0 + 10, Y0 + 3]]),
        poli('CN', [[X0, Y0 + 4], [X0 + 10, Y0 + 4]], false, 700),
      ]),
    );
    const t = terrenoDoDxf(d, { fuso: 23 });
    expect(t.ruas).toHaveLength(2); // VIAS + SISTEMA_VIARIO
    expect(t.calcadas).toHaveLength(1);
    expect(t.meioFio).toHaveLength(1);
    expect(t.curvas).toHaveLength(1);
  });

  it('curva de nível sem cota vira aviso e fica de fora; sem nenhuma camada, avisa', () => {
    const d = lerDxf(dxf([poli('CURVAS', [[X0, Y0], [X0 + 10, Y0]])]));
    const t = terrenoDoDxf(d, { fuso: 23 });
    expect(t.curvas).toEqual([]);
    expect(t.avisos[0]).toMatch(/sem cota/);
    const vazio = terrenoDoDxf(lerDxf(dxf([poli('LOTES', [[X0, Y0], [X0 + 1, Y0], [X0 + 1, Y0 + 1], [X0, Y0 + 1]], true)])), { fuso: 23 });
    expect(vazio.avisos[0]).toMatch(/Nenhuma rua/);
  });

  it('em graus (sem fuso), passa os pontos direto', () => {
    const d = lerDxf(dxf([poli('RUAS', [[-46.65, -23.56], [-46.649, -23.559]])]));
    const t = terrenoDoDxf(d);
    expect(t.ruas).toEqual([[[-46.65, -23.56], [-46.649, -23.559]]]);
  });
});
