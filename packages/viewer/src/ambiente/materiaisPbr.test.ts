import { describe, expect, it } from 'vitest';
import { ALTURA_SUJEIRA_M, CATEGORIAS_PBR, ESCALA_PBR_M, fatorSujeiraDaBase, prepararPbrMundo, repeticaoPorMetro, urlsPbr, usaProjecaoDoPiso } from './materiaisPbr';

describe('escala da textura por metro', () => {
  it('ladrilho de 0,5 m repete 2× por metro de mundo', () => {
    expect(repeticaoPorMetro(0.5)).toBeCloseTo(2);
  });

  it('régua de 2 m repete meia vez por metro', () => {
    expect(repeticaoPorMetro(2)).toBeCloseTo(0.5);
  });

  it('rejeita escala zero ou negativa', () => {
    expect(() => repeticaoPorMetro(0)).toThrow();
    expect(() => repeticaoPorMetro(-1)).toThrow();
  });

  it('cada categoria tem uma escala positiva', () => {
    for (const c of CATEGORIAS_PBR) expect(ESCALA_PBR_M[c]).toBeGreaterThan(0);
  });
});

describe('URL das texturas', () => {
  it('monta cor, normal e rugosidade dentro da pasta da categoria', () => {
    expect(urlsPbr('/texturas/', 'grama')).toEqual({ cor: '/texturas/grama/cor.webp', normal: '/texturas/grama/normal.webp', rugosidade: '/texturas/grama/rugosidade.webp' });
  });
});

describe('projeção pela normal (piso/teto × parede)', () => {
  it('normal quase vertical (piso ou teto) usa X/Z do mundo', () => {
    expect(usaProjecaoDoPiso(1)).toBe(true);
    expect(usaProjecaoDoPiso(-0.9)).toBe(true);
  });

  it('normal horizontal (parede) usa a tangente e a altura', () => {
    expect(usaProjecaoDoPiso(0)).toBe(false);
    expect(usaProjecaoDoPiso(0.3)).toBe(false);
  });

  it('o limiar é 0,5 (o mesmo do shader)', () => {
    expect(usaProjecaoDoPiso(0.49)).toBe(false);
    expect(usaProjecaoDoPiso(0.51)).toBe(true);
  });
});

describe('sujeira leve na base', () => {
  it('forte rente ao chão, zero a partir da altura limite', () => {
    expect(fatorSujeiraDaBase(0)).toBe(1);
    expect(fatorSujeiraDaBase(ALTURA_SUJEIRA_M)).toBe(0);
    expect(fatorSujeiraDaBase(ALTURA_SUJEIRA_M * 2)).toBe(0);
  });

  it('diminui conforme sobe (sem saltos)', () => {
    const a = fatorSujeiraDaBase(0.1);
    const b = fatorSujeiraDaBase(0.3);
    const c = fatorSujeiraDaBase(0.5);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
});

describe('injeção no shader (desligado por padrão, liga depois)', () => {
  it('prepara o material com onBeforeCompile encadeado e desligado (liso) até aplicar a textura', async () => {
    const THREE = await import('three');
    const m = new THREE.MeshStandardMaterial();
    let antes = 0;
    m.onBeforeCompile = () => void antes++;
    const estado = prepararPbrMundo(m, 1.5);
    expect(estado.ligado.value).toBe(0);
    expect(estado.escala.value).toBeCloseTo(repeticaoPorMetro(1.5));

    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    } as unknown as Parameters<typeof m.onBeforeCompile>[0];
    m.onBeforeCompile(shader, undefined as never);

    expect(antes).toBe(1); // não perde quem já mexia no material
    expect(shader.uniforms.uPbrLigado).toBe(estado.ligado);
    expect(shader.uniforms.uPbrCor).toBe(estado.cor);
    expect(shader.vertexShader).toContain('vPbrMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    expect(shader.fragmentShader).toContain('pbrUvMundo');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = texture2D(uPbrCor, pbrUv).rgb;');
    expect(shader.fragmentShader).toContain('roughnessFactor = clamp(pbrRug');
    expect(shader.fragmentShader).toContain('normal = normalize(mat3(viewMatrix) * pbrNMundoRelevo);');
    expect(m.customProgramCacheKey()).toMatch(/-pbrmundo$/);
  });
});
