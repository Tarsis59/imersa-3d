import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { aplicarBakeNoModelo, CHAVE_LIGHTMAP_DIA, CHAVE_LIGHTMAP_NOITE, injetarLightmap } from './lightmap';

describe('bake de luz (dia/noite) no shader', () => {
  it('o shader do three tem os pontos de encaixe (USE_UV1 do aoMap) e mistura dia↔noite pela hora', () => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    const dia = new THREE.Texture();
    const noite = new THREE.Texture();
    const f = { noite: { value: 0.3 }, intensidade: { value: 1 } };
    injetarLightmap(shader, { dia, noite }, f);
    expect(shader.fragmentShader).toContain('#if defined( USE_UV1 )');
    expect(shader.fragmentShader).toContain('mix(fBakeDia, fBakeNoite, uBakeNoiteFator)');
    expect((shader.uniforms as Record<string, { value: unknown }>).uBakeDia!.value).toBe(dia);
    expect((shader.uniforms as Record<string, { value: unknown }>).uBakeNoite!.value).toBe(noite);
    expect(shader.uniforms.uBakeNoiteFator).toBe(f.noite);
    expect(shader.uniforms.uBakeIntensidade).toBe(f.intensidade);
    // depois da luz calculada (outgoingLight já com a cena), antes do fog/tonemap do include seguinte
    expect(shader.fragmentShader.indexOf('#include <lights_fragment_end>')).toBeLessThan(shader.fragmentShader.indexOf('outgoingLight += mix'));
  });

  it('aplica só nos materiais com os dois extras (dia e noite); encadeia o onBeforeCompile que já existir', async () => {
    const comBake = new THREE.MeshStandardMaterial();
    comBake.userData = { [CHAVE_LIGHTMAP_DIA]: 2, [CHAVE_LIGHTMAP_NOITE]: 3 };
    let antes = 0;
    comBake.onBeforeCompile = () => void antes++;
    const soDia = new THREE.MeshStandardMaterial();
    soDia.userData = { [CHAVE_LIGHTMAP_DIA]: 5 }; // sem o par: não é um bake válido
    const semBake = new THREE.MeshStandardMaterial();

    const grupo = new THREE.Group();
    grupo.add(new THREE.Mesh(new THREE.BoxGeometry(), comBake));
    grupo.add(new THREE.Mesh(new THREE.BoxGeometry(), soDia));
    grupo.add(new THREE.Mesh(new THREE.BoxGeometry(), semBake));

    const texturas = new Map<number, THREE.Texture>([
      [2, new THREE.Texture()],
      [3, new THREE.Texture()],
    ]);
    const pedidos: number[] = [];
    const n = await aplicarBakeNoModelo(grupo, async (i) => {
      pedidos.push(i);
      return texturas.get(i)!;
    }, { noite: { value: 0 }, intensidade: { value: 1 } });

    expect(n).toBe(1);
    expect(pedidos.sort()).toEqual([2, 3]);
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as Parameters<typeof comBake.onBeforeCompile>[0];
    comBake.onBeforeCompile(shader, undefined as never);
    expect(antes).toBe(1); // não perde quem já mexia no material
    expect((shader.uniforms as Record<string, { value: unknown }>).uBakeDia!.value).toBe(texturas.get(2));
    expect(soDia.onBeforeCompile.toString()).not.toContain('uBakeDia'); // sem os dois extras, fica intocado
  });
});
