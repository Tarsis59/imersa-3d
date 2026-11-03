import * as THREE from 'three';

/**
 * Luz pré-calculada (Plano 12a, item 6): o bake no Blender/Cycles (`servicos/reconstrucao/kaggle/bake_blender.py`)
 * grava, no GLB do prédio, UV2 (canal 2 do glTF, `TEXCOORD_1`) com:
 * - a oclusão ambiente no `occlusionTexture` padrão do glTF (three.js já lê isso como `aoMap`, sem código nenhum
 *   aqui: o `GLTFLoader` usa `texture.channel` e a varying `vUv1` automaticamente);
 * - duas texturas de luz difusa (dia e noite) que o glTF não tem como representar num slot padrão: elas entram
 *   como `extras` no material (`imersa_lightmap_dia`/`imersa_lightmap_noite`, o índice de cada textura), que o
 *   `GLTFLoader` copia para `material.userData`. Este módulo lê esses extras e mistura as duas pela hora do dia.
 */

export const CHAVE_LIGHTMAP_DIA = 'imersa_lightmap_dia';
export const CHAVE_LIGHTMAP_NOITE = 'imersa_lightmap_noite';

export interface LightmapBake {
  /** 0 de dia → 1 de noite (mesmo fator da fachada da cidade e das janelas acesas). */
  noite: { value: number };
  /** 0 a 1: quanto do bake aparece (baixo = 0, para não gastar 2 leituras de textura extra no celular fraco). */
  intensidade: { value: number };
}

/**
 * Injeta a mistura dia/noite do bake no material (chamar dentro do `onBeforeCompile`, encadeado com o que já
 * existir). Depende do `aoMap` padrão (canal UV2) já estar presente no material para a varying `vUv1` existir;
 * sem AO assada, o bake simplesmente não teria UV2 — então os dois sempre vêm juntos neste projeto.
 */
export function injetarLightmap(shader: THREE.WebGLProgramParametersWithUniforms, texturas: { dia: THREE.Texture; noite: THREE.Texture }, f: LightmapBake): void {
  shader.uniforms.uBakeDia = { value: texturas.dia };
  shader.uniforms.uBakeNoite = { value: texturas.noite };
  shader.uniforms.uBakeNoiteFator = f.noite;
  shader.uniforms.uBakeIntensidade = f.intensidade;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform sampler2D uBakeDia;\nuniform sampler2D uBakeNoite;\nuniform float uBakeNoiteFator;\nuniform float uBakeIntensidade;',
    )
    .replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      #if defined( USE_UV1 )
      vec3 fBakeDia = texture2D(uBakeDia, vUv1).rgb;
      vec3 fBakeNoite = texture2D(uBakeNoite, vUv1).rgb;
      outgoingLight += mix(fBakeDia, fBakeNoite, uBakeNoiteFator) * uBakeIntensidade;
      #endif`,
    );
}

/** Índice de textura (extras do glTF) ou null se o material não tiver os dois bakes (dia e noite). */
function indicesDoBake(material: THREE.Material): { dia: number; noite: number } | null {
  const extras = material.userData as Record<string, unknown>;
  const dia = extras[CHAVE_LIGHTMAP_DIA];
  const noite = extras[CHAVE_LIGHTMAP_NOITE];
  return typeof dia === 'number' && typeof noite === 'number' ? { dia, noite } : null;
}

/**
 * Aplica o bake de luz (se houver) em todos os materiais do modelo carregado por `GLTFLoader`. Chamar depois de
 * `gltf.scene` estar na cena. `resolverTextura` busca a textura pelo índice do glTF (`gltf.parser.getDependency`).
 */
export async function aplicarBakeNoModelo(
  modelo: THREE.Object3D,
  resolverTextura: (indice: number) => Promise<THREE.Texture>,
  estado: LightmapBake,
): Promise<number> {
  const materiais = new Map<THREE.Material, { dia: number; noite: number }>();
  const semBake = new Map<THREE.Material, THREE.Material>();
  modelo.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // peça que ficou fora do bake (ambiente, vão do IFC) não tem a UV2: com o material assado ela leria o lightmap
    // num ponto só do atlas (escura). Ganha uma cópia do material sem o bake (o material é dividido entre peças).
    if (!o.geometry.getAttribute('uv1')) {
      const trocar = (m: THREE.Material) => {
        if (!indicesDoBake(m) && !(m as THREE.MeshStandardMaterial).aoMap) return m;
        let c = semBake.get(m);
        if (!c) {
          c = m.clone();
          c.userData = { ...m.userData, [CHAVE_LIGHTMAP_DIA]: undefined, [CHAVE_LIGHTMAP_NOITE]: undefined };
          if ('aoMap' in c) (c as THREE.MeshStandardMaterial).aoMap = null;
          semBake.set(m, c);
        }
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(trocar) : trocar(o.material);
      return;
    }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (materiais.has(m)) continue;
      const indices = indicesDoBake(m);
      if (indices) materiais.set(m, indices);
    }
  });
  await Promise.all(
    [...materiais].map(async ([material, indices]) => {
      const [dia, noite] = await Promise.all([resolverTextura(indices.dia), resolverTextura(indices.noite)]);
      const antes = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        antes.call(material, shader, renderer);
        injetarLightmap(shader, { dia, noite }, estado);
      };
      material.needsUpdate = true;
    }),
  );
  return materiais.size;
}
