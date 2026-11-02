import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export interface PosProcessamento {
  desenhar(): void;
  /** Brilho suave das luzes (0 = desligado). De dia fica desligado: o céu é tão claro que o brilho lavaria a imagem. */
  definirBrilho(forca: number): void;
  /** Tamanho em pixels de CSS e a densidade da tela (o compositor trabalha em pixels de verdade). */
  redimensionar(largura: number, altura: number, densidade: number): void;
  destruir(): void;
}

/**
 * Acabamento de imagem (só no nível de qualidade alto):
 * - sombra de contato nos cantos e encontros (GTAO, ambient occlusion);
 * - brilho suave das luzes à noite (janelas acesas);
 * - antisserrilhado por MSAA no alvo do compositor (o do canvas não vale quando há pós-processamento);
 * - tom e cor finais (AgX/ACES do renderer, sRGB) pelo OutputPass.
 * Carregado depois da 1ª imagem (import dinâmico): não pesa na abertura.
 */
export function criarPos(renderer: THREE.WebGLRenderer, cena: THREE.Scene, camera: THREE.PerspectiveCamera): PosProcessamento {
  const tamanho = renderer.getDrawingBufferSize(new THREE.Vector2());
  const alvo = new THREE.WebGLRenderTarget(tamanho.x, tamanho.y, { type: THREE.HalfFloatType, samples: 4 });
  const compositor = new EffectComposer(renderer, alvo);
  compositor.addPass(new RenderPass(cena, camera));
  const ao = new GTAOPass(cena, camera, tamanho.x, tamanho.y);
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12, distanceFallOff: 1 });
  ao.blendIntensity = 0.85;
  compositor.addPass(ao);
  const brilho = new UnrealBloomPass(new THREE.Vector2(tamanho.x, tamanho.y), 0.35, 0.5, 0.85);
  brilho.enabled = false;
  compositor.addPass(brilho);
  compositor.addPass(new OutputPass());

  return {
    desenhar() {
      compositor.render();
    },
    definirBrilho(forca) {
      brilho.enabled = forca > 0.05;
      brilho.strength = 0.35 * forca;
    },
    redimensionar(largura, altura, densidade) {
      compositor.setPixelRatio(densidade);
      compositor.setSize(largura, altura);
    },
    destruir() {
      compositor.dispose();
      ao.dispose();
      brilho.dispose();
      alvo.dispose();
    },
  };
}
