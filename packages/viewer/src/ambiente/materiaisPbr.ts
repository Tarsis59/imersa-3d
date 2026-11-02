import * as THREE from 'three';

/**
 * Materiais PBR de verdade (Plano 12a, item 5): textura CC0 (ambientCG) de cor, normal e rugosidade, projetada pela
 * posição do mundo (não pela UV da malha, que nas peças da fachada e nas fitas da cidade não tem escala real) —
 * piso/teto usa X/Z do mundo, parede usa a tangente horizontal e a altura; a mesma regra do relevo por textura (sem
 * atributo de tangente) reaproveita o algoritmo de bump do three (Mikkelsen), só que em espaço de mundo. Desligado
 * por padrão (material liso de sempre) até `aplicarTexturasPbr` ligar — carregamento preguiçoso, só nos níveis
 * médio e alto (ver `viewer.ts`, `aplicarQualidade`).
 */

export type CategoriaPbr = 'concreto' | 'porcelanato' | 'madeira' | 'grama' | 'asfalto';
export const CATEGORIAS_PBR: readonly CategoriaPbr[] = ['concreto', 'porcelanato', 'madeira', 'grama', 'asfalto'];

/** Metros de uma repetição da textura (tamanho real do ladrilho/régua/laje), por categoria. */
export const ESCALA_PBR_M: Record<CategoriaPbr, number> = {
  concreto: 1.5,
  porcelanato: 0.6,
  madeira: 1.2,
  grama: 1,
  asfalto: 3,
};

export interface FontesPbr {
  cor: string;
  normal: string;
  rugosidade: string;
}

/** URLs das 3 texturas de uma categoria, a partir da pasta pública (ver apps/web/public/texturas). */
export function urlsPbr(baseUrl: string, categoria: CategoriaPbr): FontesPbr {
  const pasta = `${baseUrl}${categoria}/`;
  return { cor: `${pasta}cor.webp`, normal: `${pasta}normal.webp`, rugosidade: `${pasta}rugosidade.webp` };
}

/** Repetições por metro (inverso da escala): quantas vezes a textura de 1 "ladrilho" cabe por metro de mundo. */
export function repeticaoPorMetro(escalaM: number): number {
  if (!(escalaM > 0)) throw new Error('escala precisa ser positiva (metros de uma repetição)');
  return 1 / escalaM;
}

/** Mesma regra do shader: piso/teto (normal quase vertical) projeta por X/Z; parede projeta pela tangente e a altura. */
export function usaProjecaoDoPiso(normalY: number): boolean {
  return Math.abs(normalY) > 0.5;
}

/** Altura (m) até onde a sujeira da base escurece, igual ao `smoothstep` do shader. */
export const ALTURA_SUJEIRA_M = 0.6;

function suave(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 1 rente ao chão (sujeira forte) → 0 a partir de `ALTURA_SUJEIRA_M`; mesma fórmula usada no fragment shader. */
export function fatorSujeiraDaBase(alturaM: number): number {
  return 1 - suave(0, ALTURA_SUJEIRA_M, alturaM);
}

/** Textura de reserva (1×1 branco): valor inicial dos uniforms antes da textura real chegar (nunca fica sem sampler). */
let texturaPadrao: THREE.DataTexture | null = null;
function obterTexturaPadrao(): THREE.DataTexture {
  if (!texturaPadrao) {
    texturaPadrao = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texturaPadrao.needsUpdate = true;
  }
  return texturaPadrao;
}

export interface TexturasPbr {
  cor: THREE.Texture;
  normal: THREE.Texture;
  rugosidade: THREE.Texture;
}

/** 1 carregamento por conjunto de URLs (várias malhas da mesma categoria compartilham a textura). */
const cacheTexturas = new Map<string, Promise<TexturasPbr>>();

/** Baixa (ou devolve do cache) as 3 texturas de uma categoria. Preguiçoso: só é chamado quando a qualidade pede. */
export function carregarTexturasPbr(fontes: FontesPbr): Promise<TexturasPbr> {
  const chave = `${fontes.cor}|${fontes.normal}|${fontes.rugosidade}`;
  let p = cacheTexturas.get(chave);
  if (!p) {
    const carregador = new THREE.TextureLoader();
    p = Promise.all([carregador.loadAsync(fontes.cor), carregador.loadAsync(fontes.normal), carregador.loadAsync(fontes.rugosidade)]).then(([cor, normal, rugosidade]) => {
      cor.colorSpace = THREE.SRGBColorSpace;
      for (const t of [cor, normal, rugosidade]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
      }
      return { cor, normal, rugosidade };
    });
    cacheTexturas.set(chave, p);
  }
  return p;
}

export interface EstadoPbr {
  /** 0 = material liso de sempre; 1 = textura PBR ligada. */
  ligado: { value: number };
  escala: { value: number };
  cor: { value: THREE.Texture };
  normal: { value: THREE.Texture };
  rugosidade: { value: THREE.Texture };
}

/**
 * Prepara o material para receber a textura de mundo (chamar 1 vez, ao criar o material; encadeia o
 * `onBeforeCompile` que já existir, como o vento e a água). Fica desligado (liso) até `aplicarTexturasPbr`.
 */
export function prepararPbrMundo(m: THREE.Material, escalaM: number): EstadoPbr {
  const estado: EstadoPbr = {
    ligado: { value: 0 },
    escala: { value: repeticaoPorMetro(escalaM) },
    cor: { value: obterTexturaPadrao() },
    normal: { value: obterTexturaPadrao() },
    rugosidade: { value: obterTexturaPadrao() },
  };
  const antes = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    antes.call(m, shader, r);
    shader.uniforms.uPbrLigado = estado.ligado;
    shader.uniforms.uPbrEscala = estado.escala;
    shader.uniforms.uPbrCor = estado.cor;
    shader.uniforms.uPbrNormal = estado.normal;
    shader.uniforms.uPbrRugosidade = estado.rugosidade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbrMundo;\nvarying vec3 vPbrNormalMundo;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPbrMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vPbrNormalMundo = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPbrMundo;
        varying vec3 vPbrNormalMundo;
        uniform float uPbrLigado;
        uniform float uPbrEscala;
        uniform sampler2D uPbrCor;
        uniform sampler2D uPbrNormal;
        uniform sampler2D uPbrRugosidade;
        // UV de mundo (sem precisar da UV da malha): piso/teto por X/Z, parede pela tangente horizontal e a altura
        vec2 pbrUvMundo(vec3 p, vec3 n) {
          vec2 uvPiso = p.xz * uPbrEscala;
          vec2 tangente = normalize(vec2(-n.z, n.x) + 1e-5);
          vec2 uvParede = vec2(dot(p.xz, tangente), p.y) * uPbrEscala;
          return mix(uvParede, uvPiso, step(0.5, abs(n.y)));
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uPbrLigado > 0.5) {
          vec3 pbrN = normalize(vPbrNormalMundo);
          vec2 pbrUv = pbrUvMundo(vPbrMundo, pbrN);
          diffuseColor.rgb = texture2D(uPbrCor, pbrUv).rgb;
          // sujeira leve na base: gradiente escuro do chão até ${ALTURA_SUJEIRA_M.toFixed(2)} m
          float pbrSujeira = 1.0 - smoothstep(0.0, ${ALTURA_SUJEIRA_M.toFixed(2)}, vPbrMundo.y);
          diffuseColor.rgb *= 1.0 - 0.35 * pbrSujeira;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (uPbrLigado > 0.5) {
          vec2 pbrUvR = pbrUvMundo(vPbrMundo, normalize(vPbrNormalMundo));
          float pbrRug = texture2D(uPbrRugosidade, pbrUvR).r;
          // rugosidade variada: ruído de baixa frequência por célula da textura (quebra o "liso demais")
          float pbrRuido = fract(sin(dot(floor(pbrUvR * 31.0), vec2(12.9898, 78.233))) * 43758.5453);
          roughnessFactor = clamp(pbrRug * (0.82 + 0.36 * pbrRuido), 0.05, 1.0);
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (uPbrLigado > 0.5) {
          // relevo da textura de normal sem UV nem tangente da malha: mesmo algoritmo de bump do three (Mikkelsen),
          // só que com a posição e a normal do MUNDO (dFdx/dFdy do mundo, não da tela) e a normal final em view space
          vec3 pbrNMundo = normalize(vPbrNormalMundo);
          vec2 pbrUvN = pbrUvMundo(vPbrMundo, pbrNMundo);
          vec3 pbrTex = texture2D(uPbrNormal, pbrUvN).xyz * 2.0 - 1.0;
          vec2 pbrGrad = -pbrTex.xy / max(pbrTex.z, 0.2);
          vec3 pbrSigmaX = normalize(dFdx(vPbrMundo));
          vec3 pbrSigmaY = normalize(dFdy(vPbrMundo));
          vec3 pbrR1 = cross(pbrSigmaY, pbrNMundo);
          vec3 pbrR2 = cross(pbrNMundo, pbrSigmaX);
          float pbrDet = dot(pbrSigmaX, pbrR1) * faceDirection;
          vec3 pbrGradVec = sign(pbrDet) * (pbrGrad.x * pbrR1 + pbrGrad.y * pbrR2);
          vec3 pbrNMundoRelevo = normalize(abs(pbrDet) * pbrNMundo - pbrGradVec * 0.6);
          normal = normalize(mat3(viewMatrix) * pbrNMundoRelevo);
        }`,
      );
  };
  const chave = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${chave()}-pbrmundo`;
  return estado;
}

/** Liga a textura PBR (depois de baixada): material passa a mostrar a textura de verdade. */
export async function aplicarTexturasPbr(estado: EstadoPbr, fontes: FontesPbr): Promise<void> {
  const t = await carregarTexturasPbr(fontes);
  estado.cor.value = t.cor;
  estado.normal.value = t.normal;
  estado.rugosidade.value = t.rugosidade;
  estado.ligado.value = 1;
}

/** Volta ao material liso (nível baixo de qualidade): não precisa recarregar nada para ligar de novo depois. */
export function desligarPbr(estado: EstadoPbr): void {
  estado.ligado.value = 0;
}
