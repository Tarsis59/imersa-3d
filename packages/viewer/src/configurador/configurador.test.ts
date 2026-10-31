import { describe, it, expect } from 'vitest';
import { areaVisivel, categoriaPeloNome, grupoDaPeca, ordenarGrupos } from './superficies';
import { posicoesReais, uvCaixa } from './uv';
import { aleatorio, chaveDoDesenho, corDerivada, desenharPadrao, misturar, PADROES, type Contexto2D } from './padroes';
import { ajustarPose, caixaDoMovel, MOVEIS_PADRAO, movelPadrao } from './moveis';

const IDENTIDADE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Caixa w × h × d centrada na origem, como 12 triângulos indexados (faces viradas para fora). */
function caixa(w: number, h: number, d: number) {
  const [x, y, z] = [w / 2, h / 2, d / 2];
  const p = [-x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z, -x, -y, z, x, -y, z, x, y, z, -x, y, z];
  // prettier-ignore
  const i = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  return { p, i };
}

describe('superfícies personalizáveis', () => {
  it('o tipo IFC decide o grupo; ambientes e aberturas ficam de fora', () => {
    expect(grupoDaPeca('IfcSlab', undefined)?.chave).toBe('pisos');
    expect(grupoDaPeca('IfcWallStandardCase', undefined)).toMatchObject({ chave: 'paredes', categoria: 'parede', orientacao: 'vertical' });
    expect(grupoDaPeca('IfcWall', undefined)?.chave).toBe('paredes');
    expect(grupoDaPeca('IfcRoof', undefined)).toMatchObject({ chave: 'telhado', categoria: 'telhado', orientacao: 'inclinada' });
    expect(grupoDaPeca('IfcWindow', undefined)?.chave).toBe('esquadrias');
    expect(grupoDaPeca('IfcSpace', undefined)).toBeNull();
    expect(grupoDaPeca('IfcOpeningElement', undefined)).toBeNull();
    expect(grupoDaPeca('IfcBuildingElementProxy', undefined)?.chave).toBe('outros');
  });

  it('telhado modelado como laje (ROOF) ou dentro de um IfcRoof vai para Telhado; laje de piso continua piso', () => {
    expect(grupoDaPeca('IfcSlab', undefined, { predefinido: 'ROOF' })?.chave).toBe('telhado');
    expect(grupoDaPeca('IfcSlabStandardCase', undefined, { pai: 'IfcRoof' })?.chave).toBe('telhado');
    expect(grupoDaPeca('IfcCovering', undefined, { predefinido: 'ROOFING' })?.chave).toBe('telhado');
    expect(grupoDaPeca('IfcCovering', undefined, { predefinido: 'FLOORING' })?.chave).toBe('pisos');
    expect(grupoDaPeca('IfcCovering', undefined, { predefinido: 'CEILING' })?.chave).toBe('forros');
    expect(grupoDaPeca('IfcSlab', undefined, { predefinido: 'BASESLAB' })?.chave).toBe('pisos');
    expect(grupoDaPeca('IfcWall', undefined, { pai: 'IfcRoof' })?.chave).toBe('paredes');
  });

  it('GLB sem IFC agrupa pelo nome do material e adivinha a categoria', () => {
    expect(grupoDaPeca(undefined, 'Piso Sala')).toMatchObject({ chave: 'material:Piso Sala', categoria: 'piso' });
    expect(grupoDaPeca(undefined, '  ')).toBeNull();
    expect(grupoDaPeca(undefined, undefined)).toBeNull();
    expect(categoriaPeloNome('Parede pintada')).toBe('parede');
    expect(categoriaPeloNome('Granito bancada')).toBe('bancada');
    expect(categoriaPeloNome('Telhas cerâmicas')).toBe('telhado');
    expect(categoriaPeloNome('Mármore')).toBe('bancada');
    expect(categoriaPeloNome('Aço')).toBe('outro');
  });

  it('ordem: pisos e paredes primeiro, o resto por nome', () => {
    const r = ordenarGrupos([{ chave: 'outros', rotulo: 'Outros' }, { chave: 'material:B', rotulo: 'B' }, { chave: 'paredes', rotulo: 'Paredes' }, { chave: 'pisos', rotulo: 'Pisos' }, { chave: 'material:A', rotulo: 'A' }]);
    expect(r.map((g) => g.chave)).toEqual(['pisos', 'paredes', 'outros', 'material:A', 'material:B']);
  });

  it('área por orientação: laje 4 × 0,2 × 3 m → 12 m² para cima; parede 5 × 3 × 0,15 m → as duas faces grandes', () => {
    const laje = caixa(4, 0.2, 3);
    expect(areaVisivel(laje.p, laje.i, IDENTIDADE, 'cima')).toBeCloseTo(12, 6);
    expect(areaVisivel(laje.p, laje.i, IDENTIDADE, 'todas')).toBeCloseTo(2 * (12 + 0.8 + 0.6), 6);
    const parede = caixa(5, 3, 0.15);
    // faces verticais: 2 × (5 × 3) + 2 × (0,15 × 3)
    expect(areaVisivel(parede.p, parede.i, IDENTIDADE, 'vertical')).toBeCloseTo(30.9, 6);
  });

  it('telhado conta as águas inclinadas (60°), piso não', () => {
    // água de 4 × 3 m inclinada 60° em torno do eixo x: normal y = cos 60° = 0,5
    const c = Math.cos(Math.PI / 3), sn = Math.sin(Math.PI / 3);
    const agua = [-2, 0, 0, 2, 0, 0, 2, 3 * sn, -3 * c, -2, 0, 0, 2, 3 * sn, -3 * c, -2, 3 * sn, -3 * c];
    expect(areaVisivel(agua, null, IDENTIDADE, 'inclinada')).toBeCloseTo(12, 6);
    expect(areaVisivel(agua, null, IDENTIDADE, 'cima')).toBe(0);
  });

  it('a área considera a escala do mundo (matrixWorld) e triângulos sem índice', () => {
    const laje = caixa(1, 0.1, 1);
    const dobro = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 0, 5, 1];
    expect(areaVisivel(laje.p, laje.i, dobro, 'cima')).toBeCloseTo(4, 6);
    const solto = laje.i.flatMap((k) => [laje.p[k * 3]!, laje.p[k * 3 + 1]!, laje.p[k * 3 + 2]!]);
    expect(areaVisivel(solto, null, IDENTIDADE, 'cima')).toBeCloseTo(1, 6);
  });
});

describe('UV em metros por projeção em caixa', () => {
  it('piso usa (x, z) e parede usa o plano dela: 1 unidade de UV = 1 metro', () => {
    const laje = caixa(4, 0.2, 3);
    const r = uvCaixa(laje.p, laje.i);
    expect(r.posicoes.length).toBe(36 * 3);
    expect(r.uv.length).toBe(36 * 2);
    // triângulo 0 é da face z = −d/2 (normal −z): UV = (x, y)
    expect([...r.uv.slice(0, 6)]).toEqual([-2, -0.1, 2, 0.1, 2, -0.1].map((v) => Math.fround(v)));
    // face de cima (triângulos 6 e 7): normal +y, UV = (x, z) → largura 4 m e profundidade 3 m
    const topo = [...r.uv.slice(6 * 6, 8 * 6)];
    const us = topo.filter((_, k) => k % 2 === 0);
    const vs = topo.filter((_, k) => k % 2 === 1);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(4, 6);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(3, 6);
    expect([...r.normais.slice(6 * 9, 6 * 9 + 3)]).toEqual([0, 1, 0]);
  });

  it('com a matriz do nó (GLB quantizado): UV em metros do mundo, geometria e normais no espaço da malha', () => {
    const laje = caixa(1, 0.1, 1);
    const escala10 = [10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 3, 0, 0, 1];
    const r = uvCaixa(laje.p, laje.i, escala10);
    const topo = [...r.uv.slice(6 * 6, 8 * 6)];
    const us = topo.filter((_, k) => k % 2 === 0);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(10, 6);
    expect(Math.min(...us)).toBeCloseTo(-2, 6); // −0,5 × 10 + 3
    expect(Math.max(...r.posicoes)).toBeCloseTo(0.5, 6);
    expect(posicoesReais({ count: 1, getX: () => 0.25, getY: () => 0.5, getZ: () => 1 })).toEqual(new Float32Array([0.25, 0.5, 1]));
  });
});

describe('desenho dos acabamentos', () => {
  it('segunda cor derivada: escurece cores claras e clareia as escuras', () => {
    expect(corDerivada('#ffffff')).toBe('#b8b8b8');
    expect(corDerivada('#202020')).toBe('#2e2e2e');
    expect(misturar('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(() => corDerivada('azul')).toThrow(/cor inválida/);
  });

  it('é determinístico (o mesmo acabamento desenha igual) e a chave ignora maiúsculas', () => {
    const a = aleatorio(42);
    const b = aleatorio(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(chaveDoDesenho({ padrao: 'madeira', cor: '#AABBCC' })).toBe(chaveDoDesenho({ padrao: 'madeira', cor: '#aabbcc', cor2: null }));
  });

  it('todo padrão desenha dentro do quadro e começa pela cor base', () => {
    for (const padrao of PADROES) {
      const chamadas: string[] = [];
      let fora = false;
      const ctx: Contexto2D = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        fillRect: (x, y, w, h) => {
          chamadas.push(`rect ${x} ${y} ${w} ${h}`);
          if (x < -256 || y < 0 || x + w > 256 + 1e-6 + (padrao === 'tijolo' ? 128 : 0) || y + h > 256 + 1e-6) fora = true;
        },
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        arc: () => {},
        fill: () => {},
      };
      desenharPadrao(ctx, 256, { padrao, cor: '#c8b89a' });
      expect(chamadas[0], padrao).toBe('rect 0 0 256 256');
      expect(fora, padrao).toBe(false);
      if (padrao !== 'liso') expect(chamadas.length + 1, padrao).toBeGreaterThan(1);
    }
  });
});

describe('móveis padrão (licença própria)', () => {
  it('as peças batem com as medidas declaradas, apoiadas no chão e centradas', () => {
    expect(MOVEIS_PADRAO.length).toBeGreaterThanOrEqual(12);
    for (const m of MOVEIS_PADRAO) {
      const c = caixaDoMovel(m);
      expect(c.min[1], m.chave).toBeCloseTo(0, 6);
      for (let k = 0; k < 3; k++) expect(c.max[k]! - c.min[k]!, `${m.chave} eixo ${k}`).toBeCloseTo(m.dimensoes[k]!, 6);
      expect(Math.abs(c.max[0]! + c.min[0]!), `${m.chave} centrado em x`).toBeLessThan(1e-6);
      expect(Math.abs(c.max[2]! + c.min[2]!), `${m.chave} centrado em z`).toBeLessThan(1e-6);
      for (const p of m.pecas) expect(p.cor, m.chave).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(MOVEIS_PADRAO.map((m) => m.chave)).size).toBe(MOVEIS_PADRAO.length);
    expect(movelPadrao('sofa-3')?.nome).toBe('Sofá 3 lugares');
    expect(movelPadrao('nao-existe')).toBeUndefined();
  });

  it('pose: grade de 5 cm e giro entre 0 e 359', () => {
    expect(ajustarPose({ x: 1.234, y: 0.20004, z: -0.026, giroGraus: -90 })).toEqual({ x: 1.25, y: 0.2, z: -0.05, giroGraus: 270 });
    expect(ajustarPose({ x: 0, y: 0, z: 0, giroGraus: 450 }).giroGraus).toBe(90);
  });
});
