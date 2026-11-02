import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export type Clima = 'limpo' | 'nublado';

/** Parâmetros da atmosfera (modelo de Preetham do three) por clima. */
export const ATMOSFERA: Record<Clima, { turbidez: number; rayleigh: number; mie: number; cobertura: number; densidade: number }> = {
  limpo: { turbidez: 2.5, rayleigh: 1.2, mie: 0.004, cobertura: 0.22, densidade: 0.35 },
  nublado: { turbidez: 9, rayleigh: 2.6, mie: 0.006, cobertura: 0.88, densidade: 0.8 },
};

/**
 * Cor do horizonte (neblina) pela altura do sol: dia azul-claro, entardecer alaranjado, noite azul-escuro.
 * `elevacao` = seno do ângulo do sol acima do horizonte (−1 a 1).
 */
export function corDoHorizonte(elevacao: number, clima: Clima): THREE.Color {
  const noite = new THREE.Color(0x0b1224);
  const tarde = new THREE.Color(clima === 'limpo' ? 0xf0c49a : 0xb9b4b0);
  const dia = new THREE.Color(clima === 'limpo' ? 0xc8dcef : 0xc3c8cf);
  if (elevacao <= -0.08) return noite;
  if (elevacao < 0.05) return noite.clone().lerp(tarde, (elevacao + 0.08) / 0.13);
  if (elevacao < 0.3) return tarde.clone().lerp(dia, (elevacao - 0.05) / 0.25);
  return dia;
}

/** Quanto das estrelas aparece (0 de dia, 1 com o sol bem abaixo do horizonte). */
export const brilhoDasEstrelas = (elevacao: number): number => Math.min(1, Math.max(0, (-elevacao - 0.02) / 0.15));

export interface Ceu {
  /** Céu físico, nuvens e estrelas (acompanham a câmera). */
  readonly objeto: THREE.Group;
  /** `sol` = direção PARA o sol, no referencial da cena. Refaz o mapa de reflexos só quando muda. */
  atualizar(sol: THREE.Vector3, clima: Clima): void;
  /** A cada quadro: céu centrado na câmera e nuvens andando devagar. */
  quadro(camera: THREE.Camera, segundos: number): void;
  readonly horizonte: THREE.Color;
  destruir(): void;
}

/**
 * Céu de verdade: atmosfera física (cor certa no amanhecer e no pôr do sol), nuvens, estrelas à noite e o mapa de
 * ambiente gerado do próprio céu (vidro e metal refletem o céu que se vê). `cena.environment` recebe o mapa.
 */
export function criarCeu(renderer: THREE.WebGLRenderer, cena: THREE.Scene): Ceu {
  const objeto = new THREE.Group();
  objeto.name = 'ceu';
  const sky = new Sky();
  sky.scale.setScalar(3000); // dentro do alcance da câmera (4000 m)
  sky.frustumCulled = false;
  objeto.add(sky);
  const u = sky.material.uniforms;

  // estrelas: pontos fixos numa esfera grande, só à noite
  const n = 1500;
  const pos = new Float32Array(n * 3);
  let semente = 7;
  const aleatorio = () => ((semente = (semente * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < n; i++) {
    const z = aleatorio() * 0.95 + 0.05; // só acima do horizonte
    const t = aleatorio() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(t) * 2500, z * 2500, r * Math.sin(t) * 2500], i * 3);
  }
  const geoEstrelas = new THREE.BufferGeometry();
  geoEstrelas.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const matEstrelas = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const estrelas = new THREE.Points(geoEstrelas, matEstrelas);
  estrelas.frustumCulled = false;
  objeto.add(estrelas);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const cenaDoCeu = new THREE.Scene();
  const skyReflexo = new Sky(); // cópia sem o disco do sol (o disco no mapa de reflexos vira manchas)
  skyReflexo.scale.setScalar(1000);
  skyReflexo.material.uniforms.showSunDisc!.value = 0;
  cenaDoCeu.add(skyReflexo);
  let ambiente: THREE.WebGLRenderTarget | null = null;
  let ultimo = '';
  const horizonte = new THREE.Color(0xc8dcef);

  return {
    objeto,
    horizonte,
    atualizar(sol, clima) {
      const a = ATMOSFERA[clima];
      const s = sol.clone().normalize();
      for (const alvo of [u, skyReflexo.material.uniforms]) {
        alvo.turbidity!.value = a.turbidez;
        alvo.rayleigh!.value = a.rayleigh;
        alvo.mieCoefficient!.value = a.mie;
        alvo.cloudCoverage!.value = a.cobertura;
        alvo.cloudDensity!.value = a.densidade;
        alvo.sunPosition!.value.copy(s);
      }
      u.showSunDisc!.value = clima === 'limpo' ? 1 : 0;
      matEstrelas.opacity = brilhoDasEstrelas(s.y) * (clima === 'limpo' ? 1 : 0.15);
      estrelas.visible = matEstrelas.opacity > 0.01;
      horizonte.copy(corDoHorizonte(s.y, clima));
      // reflexos: refeitos só quando o sol ou o clima mudam de verdade (custa alguns ms)
      const chave = `${clima}:${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}`;
      if (chave === ultimo) return;
      ultimo = chave;
      const novo = pmrem.fromScene(cenaDoCeu, 0, 0.1, 2000);
      cena.environment = novo.texture;
      ambiente?.dispose();
      ambiente = novo;
    },
    quadro(camera, segundos) {
      objeto.position.copy(camera.position);
      u.time!.value = segundos;
    },
    destruir() {
      ambiente?.dispose();
      pmrem.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      skyReflexo.geometry.dispose();
      skyReflexo.material.dispose();
      geoEstrelas.dispose();
      matEstrelas.dispose();
    },
  };
}
