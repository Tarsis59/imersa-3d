import * as THREE from 'three';
import type { Building } from './osm';

/**
 * Fachada dos prédios da cidade (Plano 11, rodada de visual): cada prédio do OSM ganha uma cor de acabamento real
 * (concreto, pastilha clara, tijolo, cinza…), janelas de vidro por andar, laje mais escura e, à noite, janelas acesas
 * sorteadas. Tudo no shader, sem textura: continua 1 malha e 1 desenho para a cidade inteira (leve no celular).
 */

/** Acabamentos comuns nas cidades brasileiras, com o peso de cada um (mais claros são a maioria). */
export const ACABAMENTOS: ReadonlyArray<{ nome: string; cor: number; peso: number }> = [
  { nome: 'concreto claro', cor: 0xd6d1c6, peso: 5 },
  { nome: 'pastilha branca', cor: 0xebe9e3, peso: 4 },
  { nome: 'bege', cor: 0xd5c2a1, peso: 4 },
  { nome: 'cinza', cor: 0xa7a8a4, peso: 3 },
  { nome: 'azul acinzentado', cor: 0xb3c0c7, peso: 2 },
  { nome: 'ocre', cor: 0xc7a26c, peso: 2 },
  { nome: 'tijolo', cor: 0xa35b43, peso: 2 },
  { nome: 'grafite', cor: 0x6e7174, peso: 1 },
];
const PESO_TOTAL = ACABAMENTOS.reduce((s, a) => s + a.peso, 0);

/** Número de 0 a 1, sempre o mesmo para o mesmo prédio (pelo id do OSM; sem id, pelo centro). */
function sorteio(b: Building): number {
  let x = b.id || Math.round((b.footprint[0]?.x ?? 0) * 7919 + (b.footprint[0]?.z ?? 0) * 104729);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Acabamento do prédio: o mesmo prédio sempre com a mesma cor; a mistura segue os pesos. */
export function acabamentoDoPredio(b: Building): (typeof ACABAMENTOS)[number] {
  let r = sorteio(b) * PESO_TOTAL;
  for (const a of ACABAMENTOS) {
    if ((r -= a.peso) < 0) return a;
  }
  return ACABAMENTOS[0]!;
}

/** Cor por vértice (linear, pronta para `vertexColors`) com uma leve variação de tom entre prédios do mesmo acabamento. */
export function corDoPredio(b: Building): THREE.Color {
  const c = new THREE.Color(acabamentoDoPredio(b).cor);
  const variacao = 0.92 + ((sorteio(b) * 9973) % 1) * 0.12;
  return c.multiplyScalar(variacao);
}

/** Medidas do desenho das janelas (metros). */
export const JANELAS = { largura: 3.2, andar: 3.1, terreo: 4 } as const;

/** Janelas acesas à noite: ligue com o fator da noite (0 de dia → 1 à noite). */
export interface FachadaCidade {
  noite: { value: number };
}

/**
 * Injeta a fachada no material da cidade (chamar dentro do `onBeforeCompile`). O material precisa de `vertexColors`
 * e a geometria do atributo `aBase` (altura do chão sob cada prédio), que `buildCityMesh` já grava.
 */
export function injetarFachada(shader: THREE.WebGLProgramParametersWithUniforms, f: FachadaCidade): void {
  shader.uniforms.uFachadaNoite = f.noite;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aBase;\nvarying vec3 vFachadaMundo;\nvarying vec3 vFachadaNormal;\nvarying float vFachadaBase;')
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvFachadaMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFachadaNormal = normalize(mat3(modelMatrix) * objectNormal);\nvFachadaBase = aBase;',
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFachadaMundo;\nvarying vec3 vFachadaNormal;\nvarying float vFachadaBase;\nuniform float uFachadaNoite;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec3 fN = normalize(vFachadaNormal);
      float fParede = 1.0 - step(0.5, abs(fN.y));
      vec2 fTangente = normalize(vec2(-fN.z, fN.x) + vec2(1e-5));
      float fAltura = vFachadaMundo.y - vFachadaBase;
      // cada prédio com o seu ritmo de janela (a cor do vértice é a "semente" do prédio); ~1 em 6 é pele de vidro
      float fSemente = fract(dot(vColor.rgb, vec3(12.9898, 78.233, 37.719)) * 43.7585);
      float fVidroTodo = step(0.84, fSemente);
      float fLargura = ${JANELAS.largura.toFixed(2)} * (0.8 + 0.45 * fract(fSemente * 5.0));
      vec2 fCelula = vec2(dot(vFachadaMundo.xz, fTangente) / fLargura, (fAltura - ${JANELAS.terreo.toFixed(1)}) / ${JANELAS.andar.toFixed(2)});
      vec2 fDentro = fract(fCelula);
      // janela: vão no meio de cada módulo, acima do térreo; o resto é parede (com faixa de laje entre os andares)
      vec4 fVao = mix(vec4(0.16, 0.84, 0.3, 0.88), vec4(0.03, 0.97, 0.1, 0.97), fVidroTodo);
      float fJanela = fParede * step(0.0, fCelula.y) * step(fVao.x, fDentro.x) * step(fDentro.x, fVao.y) * step(fVao.z, fDentro.y) * step(fDentro.y, fVao.w);
      float fLaje = fParede * step(0.0, fCelula.y) * (1.0 - step(0.08, fDentro.y));
      diffuseColor.rgb *= 1.0 - 0.12 * fLaje;
      // apartamento falso atrás do vidro ("interior mapping"): o raio da câmera entra numa caixa do tamanho da
      // janela com 4 m de fundo e acha piso, teto, paredes e um móvel encostado no fundo, sem geometria nenhuma
      vec2 fW = clamp(vec2((fDentro.x - fVao.x) / (fVao.y - fVao.x), (fDentro.y - fVao.z) / (fVao.w - fVao.z)), 0.0, 1.0);
      vec3 fVisao = normalize(vFachadaMundo - cameraPosition);
      vec3 fRaio = vec3(dot(fVisao.xz, fTangente) / (fLargura * (fVao.y - fVao.x)), fVisao.y / (${JANELAS.andar.toFixed(2)} * (fVao.w - fVao.z)), max(dot(fVisao, -fN), 0.02) / 4.0);
      fRaio.xy = mix(fRaio.xy, vec2(1e-4), step(abs(fRaio.xy), vec2(1e-4)));
      vec3 fPonto = vec3(fW, 0.0);
      vec3 fAte = (step(0.0, fRaio) - fPonto) / fRaio;
      float fT = min(min(fAte.x, fAte.y), fAte.z);
      vec3 fAchou = fPonto + fRaio * fT;
      float fSala = fract(sin(dot(floor(fCelula), vec2(41.3, 289.1))) * 15731.7);
      vec3 fParedeSala = mix(vec3(0.8, 0.75, 0.68), vec3(0.7, 0.73, 0.75), fSala);
      vec3 fInterior = fParedeSala * 0.92;
      if (fT == fAte.y) fInterior = fRaio.y < 0.0 ? mix(vec3(0.46, 0.33, 0.23), vec3(0.62, 0.6, 0.57), step(0.6, fSala)) : vec3(0.9, 0.89, 0.86);
      else if (fT == fAte.z) fInterior = fAchou.y < 0.32 ? mix(vec3(0.32, 0.36, 0.42), vec3(0.55, 0.45, 0.36), fract(fSala * 3.0)) : fParedeSala * 0.8;
      fInterior *= 1.0 - 0.4 * fAchou.z;
      // cortina em ~metade das janelas, em alturas diferentes (de cima para baixo)
      float fCortina = fJanela * (1.0 - fVidroTodo) * step(0.5, fract(fSala * 13.0)) * step(1.0 - (0.2 + 0.65 * fract(fSala * 7.0)), fW.y);
      float fVidro = fJanela * (1.0 - fCortina);
      vec3 fVidroCor = mix(vec3(0.07, 0.1, 0.13), vec3(0.1, 0.17, 0.2), fVidroTodo);
      // de dia o vidro reflete e o interior aparece de leve; em prédio de vidro (escritório) aparece menos
      vec3 fJanelaCor = mix(fVidroCor, fInterior * 0.55, mix(0.5, 0.2, fVidroTodo));
      fJanelaCor = mix(fJanelaCor, vec3(0.84, 0.81, 0.75), fCortina);
      diffuseColor.rgb = mix(diffuseColor.rgb, fJanelaCor, 0.92 * fJanela);
      // laje de cobertura: concreto mais escuro e áspero
      diffuseColor.rgb *= mix(1.0, 0.68, step(0.5, fN.y));`,
    )
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, fVidro);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.3, fVidro);')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      // à noite ~45% das janelas acesas, sorteadas por janela (fixas: a mesma janela fica acesa a noite toda)
      float fSorte = fract(sin(dot(floor(fCelula) + floor(vFachadaMundo.xz * 0.013), vec2(12.9898, 78.233))) * 43758.5453);
      // a luz acesa mostra o apartamento por dentro (e a cortina fica amarelada, iluminada por trás)
      vec3 fLuz = mix(fInterior * vec3(1.35, 1.0, 0.7), vec3(1.0, 0.8, 0.55), fCortina);
      totalEmissiveRadiance += fLuz * fJanela * step(0.55, fSorte) * uFachadaNoite * (0.55 + 0.45 * fract(fSorte * 7.0));`,
    );
}
