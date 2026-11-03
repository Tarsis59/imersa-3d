import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHAVE_LIGHTMAP_DIA, CHAVE_LIGHTMAP_NOITE } from './lightmap';

/**
 * Confere, com o GLB "assado" de verdade (saído do `bake_blender.py` no Blender real, não simulado), que o
 * `GLTFLoader` do three.js lê o `occlusionTexture` como `aoMap` no canal 2 (UV2) e copia os extras do lightmap
 * para `material.userData` — exatamente o que `aplicarBakeNoModelo` espera (Plano 12a, item 6).
 *
 * Caminho em `IMERSA_BAKE_GLB` (ex.: a saída de `imersa_recon.bake` com `--blender`); sem a variável, pula (não
 * há GLB real nesta máquina de testes, como os testes que dependem de `IMERSA_BLENDER`).
 */
const GLB = process.env.IMERSA_BAKE_GLB;

// o GLTFLoader espera um ambiente de navegador (decodifica as texturas); aqui não interessa decodificar nada,
// só conferir a estrutura (aoMap, canal, extras), então um `createImageBitmap` falso basta.
(globalThis as Record<string, unknown>).self ??= globalThis;
(globalThis as Record<string, unknown>).createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });

describe.skipIf(!GLB || !existsSync(GLB))('GLB assado real carrega como o viewer espera', () => {
  it('occlusionTexture vira aoMap no canal UV2; os extras de dia/noite entram em material.userData', async () => {
    const dados = readFileSync(GLB!);
    const buffer = dados.buffer.slice(dados.byteOffset, dados.byteOffset + dados.byteLength) as ArrayBuffer;
    const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', (g) => resolve(g as { scene: THREE.Object3D }), reject);
    });
    let materiaisConferidos = 0;
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as THREE.MeshStandardMaterial[]) {
        expect(m.aoMap).not.toBeNull();
        expect(m.aoMap!.channel).toBe(1); // TEXCOORD_1 (UV2) do bake, não a UV0 do resto da textura
        expect(typeof m.userData[CHAVE_LIGHTMAP_DIA]).toBe('number');
        expect(typeof m.userData[CHAVE_LIGHTMAP_NOITE]).toBe('number');
        materiaisConferidos++;
      }
    });
    expect(materiaisConferidos).toBeGreaterThan(0);
  }, 20_000);
});
