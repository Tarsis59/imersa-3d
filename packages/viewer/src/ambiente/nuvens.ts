import * as THREE from 'three';
import { VENTO } from './vegetacao';

/**
 * Nuvens baixas com sombra no chão (Plano 12a, item 15): uma camada de nuvens que a câmera atravessa ao subir
 * (esmaecendo perto dela) e a sombra delas andando devagar pelo chão. Desligado no aparelho fraco.
 */

/** Altura da camada de nuvens baixas, em metros. */
export const ALTURA_NUVENS_M = 320;
/** Faixa (para cada lado) em que a nuvem esmaece perto da câmera, para ela não ver uma borda dura ao atravessar. */
export const FAIXA_FADE_M = 60;

/** 0 rente à câmera (esmaecida, ela está atravessando) → 1 na distância normal de ver a nuvem. */
export function opacidadeNuvem(alturaCamera: number, alturaNuvem = ALTURA_NUVENS_M, faixa = FAIXA_FADE_M): number {
  return Math.min(1, Math.max(0, Math.abs(alturaCamera - alturaNuvem) / faixa));
}

/** Liga a camada (e a sombra) só a partir da qualidade média: no aparelho fraco, nenhuma. */
export const NUVENS_POR_NIVEL: Record<'alto' | 'medio' | 'baixo', boolean> = { alto: true, medio: true, baixo: false };

/** Liga/desliga a sombra das nuvens no chão sem recompilar o shader (um uniforme compartilhado). */
export const SOMBRA_NUVENS = { ligada: { value: 1 } };

function aleatorio(semente: number): () => number {
  let s = semente >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Textura de uma nuvem: manchas brancas com borda suave desenhadas num canvas, sem baixar nada da internet. */
function texturaDeNuvem(): THREE.CanvasTexture {
  const tela = document.createElement('canvas');
  tela.width = tela.height = 128;
  const ctx = tela.getContext('2d')!;
  const rnd = aleatorio(31);
  for (let i = 0; i < 7; i++) {
    const x = 30 + rnd() * 68;
    const y = 40 + rnd() * 48;
    const r = 22 + rnd() * 28;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(tela);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Nuvem {
  sprite: THREE.Sprite;
  x: number;
  z: number;
  altura: number;
  fase: number;
  opacidadeBase: number;
}

export interface Nuvens {
  objeto: THREE.Group;
  materiais: THREE.Material[];
  /** Nuvens seguem a câmera no plano (como o céu) e esmaecem perto dela; andam devagar com `segundos`. */
  quadro(camera: THREE.Camera, segundos: number): void;
  definirNivel(nivel: 'alto' | 'medio' | 'baixo'): void;
  destruir(): void;
}

const QUANTAS = 26;
const RAIO_CAMPO_M = 900;

/** Camada de nuvens (sprites sempre de frente para a câmera), espalhadas em volta, sempre as mesmas. */
export function criarNuvens(preparar: (m: THREE.Material) => void): Nuvens {
  const objeto = new THREE.Group();
  objeto.name = 'nuvens';
  const textura = texturaDeNuvem();
  const materialBase = new THREE.SpriteMaterial({ map: textura, transparent: true, depthWrite: false, fog: false });
  preparar(materialBase);
  const materiais: THREE.Material[] = [materialBase];
  const rnd = aleatorio(53);
  const nuvens: Nuvem[] = [];
  for (let i = 0; i < QUANTAS; i++) {
    const material = materialBase.clone();
    materiais.push(material);
    const sprite = new THREE.Sprite(material);
    const tamanho = 110 + rnd() * 140;
    sprite.scale.set(tamanho, tamanho * 0.5, 1);
    const angulo = rnd() * Math.PI * 2;
    const raio = 120 + rnd() * RAIO_CAMPO_M;
    const n: Nuvem = {
      sprite,
      x: Math.cos(angulo) * raio,
      z: Math.sin(angulo) * raio,
      altura: ALTURA_NUVENS_M + (rnd() - 0.5) * 70,
      fase: rnd() * 1000,
      opacidadeBase: 0.45 + rnd() * 0.35,
    };
    sprite.position.set(n.x, n.altura, n.z);
    nuvens.push(n);
    objeto.add(sprite);
  }
  return {
    objeto,
    materiais,
    quadro(camera, segundos) {
      objeto.position.set(camera.position.x, 0, camera.position.z); // segue a câmera no plano, como o céu
      for (const n of nuvens) {
        // deriva bem devagar: parece vento de altitude, não um carrossel
        n.sprite.position.set(n.x + Math.sin(segundos * 0.015 + n.fase) * 20, n.altura, n.z + Math.cos(segundos * 0.012 + n.fase) * 20);
        (n.sprite.material as THREE.SpriteMaterial).opacity = n.opacidadeBase * opacidadeNuvem(camera.position.y, n.altura);
      }
    },
    definirNivel(nivel) {
      objeto.visible = NUVENS_POR_NIVEL[nivel];
    },
    destruir() {
      textura.dispose();
      for (const m of materiais) m.dispose();
    },
  };
}

/**
 * Sombra das nuvens no chão (Plano 12a, item 15): escurece um pouco a luz do chão num padrão que anda devagar
 * (mesmo relógio do vento), como a sombra das nuvens lá em cima. `SOMBRA_NUVENS.ligada` desliga no aparelho fraco
 * sem recompilar o material. Chamar depois de preparar o material (encadeia o `onBeforeCompile` que já existe).
 */
export function sombraDeNuvens(m: THREE.Material): void {
  const antes = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    antes.call(m, shader, r);
    shader.uniforms.uNuvensTempo = VENTO.tempo;
    shader.uniforms.uNuvensLigada = SOMBRA_NUVENS.ligada;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSombraNuvemMundo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSombraNuvemMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSombraNuvemMundo;\nuniform float uNuvensTempo;\nuniform float uNuvensLigada;')
      .replace(
        '#include <dithering_fragment>',
        `float nx = vSombraNuvemMundo.x * 0.012 + uNuvensTempo * 0.02;
        float nz = vSombraNuvemMundo.z * 0.012 - uNuvensTempo * 0.015;
        float nuvem = sin(nx) * sin(nz * 1.3 + 0.7) * 0.5 + 0.5;
        float sombra = mix(1.0, 0.78, smoothstep(0.35, 0.75, nuvem) * uNuvensLigada);
        gl_FragColor.rgb *= sombra;
        #include <dithering_fragment>`,
      );
  };
  const chave = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${chave()}-sombra-nuvens`;
}
