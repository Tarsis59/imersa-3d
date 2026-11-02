import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCityMesh } from './cityMesh';
import { ACABAMENTOS, acabamentoDoPredio, corDoPredio, injetarFachada } from './fachadaCidade';
import type { Building } from './osm';

const predio = (id: number, base = 0): Building => ({ id, height: 30, base, footprint: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: -10 }, { x: 0, z: -10 }] });

describe('fachada da cidade', () => {
  it('o mesmo prédio sempre com o mesmo acabamento; a cidade mistura todos, mais os claros', () => {
    expect(acabamentoDoPredio(predio(42)).nome).toBe(acabamentoDoPredio(predio(42)).nome);
    expect(corDoPredio(predio(42)).getHex()).toBe(corDoPredio(predio(42)).getHex());
    const conta = new Map<string, number>();
    for (let id = 1; id <= 4000; id++) conta.set(acabamentoDoPredio(predio(id * 7 + 13)).nome, (conta.get(acabamentoDoPredio(predio(id * 7 + 13)).nome) ?? 0) + 1);
    expect(conta.size).toBe(ACABAMENTOS.length);
    // concreto claro (peso 5) aparece bem mais que grafite (peso 1)
    expect(conta.get('concreto claro')!).toBeGreaterThan(conta.get('grafite')! * 3);
  });

  it('a malha única leva a cor e o chão de cada prédio em cada vértice', () => {
    const m = buildCityMesh([predio(1, 0), predio(2, 12.5)], new THREE.MeshStandardMaterial({ vertexColors: true }));
    const cor = m.geometry.getAttribute('color');
    const base = m.geometry.getAttribute('aBase');
    expect(cor.itemSize).toBe(3);
    expect(base.count).toBe(m.geometry.getAttribute('position').count);
    const bases = new Set(Array.from(base.array as Float32Array));
    expect([...bases].sort()).toEqual([0, 12.5]);
  });

  it('o shader do three tem todos os pontos de encaixe (senão a fachada sumiria sem aviso)', () => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    const noite = { value: 0.7 };
    injetarFachada(shader, { noite });
    expect(shader.vertexShader).toContain('attribute float aBase;');
    expect(shader.vertexShader).toContain('vFachadaBase = aBase;');
    for (const trecho of ['float fJanela', 'roughnessFactor = mix(roughnessFactor, 0.12, fVidro)', 'metalnessFactor = mix(metalnessFactor, 0.3, fVidro)', 'totalEmissiveRadiance += fLuz * fJanela']) {
      expect(shader.fragmentShader).toContain(trecho);
    }
    // a janela é usada depois de declarada (cor → rugosidade → brilho da noite)
    const f = shader.fragmentShader;
    expect(f.indexOf('float fJanela')).toBeLessThan(f.indexOf('roughnessFactor = mix'));
    expect(f.indexOf('roughnessFactor = mix')).toBeLessThan(f.indexOf('totalEmissiveRadiance += fLuz'));
    // apartamento falso e cortina: o raio da câmera entra na janela
    expect(f).toContain('vec3 fVisao = normalize(vFachadaMundo - cameraPosition)');
    expect(f).toContain('float fCortina');
    expect((shader.uniforms as Record<string, unknown>).uFachadaNoite).toBe(noite);
  });
});
