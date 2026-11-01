import { describe, it, expect } from 'vitest';
import { blocosDaPlanta, subtrairIntervalos, type EdicaoPlanta } from './planta3d';
import { exportarGlb, montarPlanta3d } from './exportar';

// o exportador GLB do three usa o FileReader do navegador; no Node, um equivalente mínimo
class LeitorDeArquivo {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(b: Blob) {
    void b.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.();
    });
  }
  readAsDataURL(b: Blob) {
    void b.arrayBuffer().then((r) => {
      this.result = `data:${b.type};base64,${Buffer.from(r).toString('base64')}`;
      this.onloadend?.();
    });
  }
}
(globalThis as { FileReader?: unknown }).FileReader ??= LeitorDeArquivo;

const base: Omit<EdicaoPlanta, 'paredes' | 'aberturas'> = { escalaMPorPx: 0.02, alturaParedeM: 2.8, alturaPortaM: 2.1, peitorilM: 1, alturaJanelaM: 1.2 };
// parede de 10 m (500 px) com 20 cm (10 px) de espessura
const parede = { x1: 0, y1: 0, x2: 500, y2: 0, espessura: 10 };

describe('planta → 3D', () => {
  it('intervalos: vãos saem da parede, mesmo sobrepostos ou passando da ponta', () => {
    expect(subtrairIntervalos(10, [[2, 3]])).toEqual([[0, 2], [3, 10]]);
    expect(subtrairIntervalos(10, [[4, 6], [5, 7], [-1, 1]])).toEqual([[1, 4], [7, 10]]);
    expect(subtrairIntervalos(10, [[9, 12]])).toEqual([[0, 9]]);
    expect(subtrairIntervalos(10, [])).toEqual([[0, 10]]);
  });

  it('porta inserida na parede: parede em 2 pedaços + verga + folha, em metros', () => {
    const b = blocosDaPlanta({ ...base, paredes: [parede], aberturas: [{ tipo: 'porta', x1: 200, y1: 0, x2: 245, y2: 0, espessura: 10 }] });
    const paredes = b.filter((x) => x.tipo === 'IfcWall');
    // 2 pedaços (4 m e 5,1 m) e a verga de 0,9 m entre 2,1 e 2,8 m
    expect(paredes.map((x) => +x.tamanho[0].toFixed(3)).sort()).toEqual([0.9, 4, 5.1]);
    const verga = paredes.find((x) => Math.abs(x.tamanho[0] - 0.9) < 1e-9)!;
    expect(verga.tamanho[1]).toBeCloseTo(0.7);
    expect(verga.centro[1]).toBeCloseTo(2.45);
    const folha = b.find((x) => x.tipo === 'IfcDoor')!;
    expect(folha.tamanho[1]).toBeCloseTo(2.1);
    expect(paredes.every((x) => Math.abs(x.tamanho[2] - 0.2) < 1e-9)).toBe(true);
  });

  it('janela num vão entre paredes (como o detector entrega): peitoril, verga e vidro; passagem fica aberta', () => {
    const b = blocosDaPlanta({
      ...base,
      paredes: [{ ...parede, x2: 200 }, { ...parede, x1: 300 }],
      aberturas: [
        { tipo: 'janela', x1: 200, y1: 0, x2: 300, y2: 0, espessura: 10 },
        { tipo: 'passagem', x1: 0, y1: 100, x2: 100, y2: 100, espessura: 10 },
      ],
    });
    const vidro = b.find((x) => x.tipo === 'IfcWindow')!;
    expect(vidro.tamanho[0]).toBeCloseTo(2);
    expect(vidro.centro[1]).toBeCloseTo(1.6);
    const daJanela = b.filter((x) => x.tipo === 'IfcWall' && Math.abs(x.tamanho[0] - 2) < 1e-9);
    expect(daJanela.map((x) => +x.tamanho[1].toFixed(3)).sort()).toEqual([0.6, 1]);
    expect(b.filter((x) => x.tipo === 'IfcDoor')).toEqual([]);
    expect(b.filter((x) => x.tipo === 'IfcSlab')).toHaveLength(1);
  });

  it('parede vertical gira 90° e o desenho fica centrado na origem; piso cobre até a face externa', () => {
    const b = blocosDaPlanta({ ...base, paredes: [parede, { x1: 500, y1: 0, x2: 500, y2: 300, espessura: 10 }], aberturas: [] });
    const vertical = b.find((x) => x.tipo === 'IfcWall' && Math.abs(x.giroY) > 0.1)!;
    expect(Math.abs(vertical.giroY)).toBeCloseTo(Math.PI / 2);
    expect(vertical.centro[0]).toBeCloseTo(5);
    const piso = b.find((x) => x.tipo === 'IfcSlab')!;
    expect(piso.centro[0]).toBeCloseTo(0);
    expect(piso.tamanho[0]).toBeCloseTo(10.2);
    expect(piso.tamanho[2]).toBeCloseTo(6.2);
  });

  it('cena com tipo IFC em cada peça e GLB válido', async () => {
    const e: EdicaoPlanta = { ...base, paredes: [parede], aberturas: [{ tipo: 'janela', x1: 100, y1: 0, x2: 160, y2: 0, espessura: 10 }] };
    const g = montarPlanta3d(e);
    const tipos = g.children.map((m) => m.userData.ifc as string);
    expect(new Set(tipos)).toEqual(new Set(['IfcWall', 'IfcWindow', 'IfcSlab']));
    expect(g.children.find((m) => m.userData.ifc === 'IfcSlab')!.userData.ifcTipo).toBe('FLOOR');
    expect(new Set(g.children.map((m) => m.name)).size).toBe(g.children.length);
    const glb = await exportarGlb(e);
    expect(new TextDecoder().decode(new Uint8Array(glb, 0, 4))).toBe('glTF');
    // os extras (tipo IFC) vão no JSON do GLB
    const json = new TextDecoder().decode(new Uint8Array(glb, 20, new DataView(glb).getUint32(12, true)));
    expect(json).toContain('"extras":{"ifc":"IfcWindow"}');
  });
});
