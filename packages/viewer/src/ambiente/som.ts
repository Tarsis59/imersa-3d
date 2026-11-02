import * as THREE from 'three';

/**
 * Som ambiente sintetizado no próprio navegador (nada para baixar, nenhuma licença de áudio): pássaros nas árvores,
 * o fundo da rua e a água da piscina, posicionados no espaço (chegar perto da piscina aumenta a água). Liga só por
 * um gesto da pessoa (regra dos navegadores) e fica desligado por padrão.
 */

/** Volume do fundo da rua pela altura da câmera: forte no chão, fraco lá do alto. */
export const volumeDaRua = (alturaM: number): number => THREE.MathUtils.clamp(1 - alturaM / 120, 0.15, 1) * 0.22;

/** Um canto: notas curtas que descem ou sobem (trinado), com pausas entre elas. */
export function cantoDePassaro(rnd: () => number): Array<{ de: number; ate: number; duracaoS: number; pausaS: number }> {
  const notas = 2 + Math.floor(rnd() * 4);
  const base = 2600 + rnd() * 2400;
  return Array.from({ length: notas }, () => {
    const de = base * (0.9 + rnd() * 0.3);
    return { de, ate: de * (rnd() < 0.5 ? 0.7 : 1.25), duracaoS: 0.05 + rnd() * 0.08, pausaS: 0.03 + rnd() * 0.07 };
  });
}

/** Ruído marrom (grave, como o de uma rua ao longe), em loop. */
function ruidoMarrom(ctx: AudioContext, segundos = 3): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * segundos), ctx.sampleRate);
  const d = b.getChannelData(0);
  let ultimo = 0;
  for (let i = 0; i < d.length; i++) {
    const branco = Math.random() * 2 - 1;
    ultimo = (ultimo + 0.02 * branco) / 1.02;
    d[i] = ultimo * 3.5;
  }
  return b;
}

export interface FontesDeSom {
  /** Árvores (os pássaros cantam nelas). */
  arvores: ReadonlyArray<{ x: number; z: number; altura: number }>;
  /** Piscinas e espelhos d'água. */
  agua: ReadonlyArray<{ x: number; y: number; z: number }>;
}

export interface AmbienteSonoro {
  ligado(): boolean;
  /** Precisa vir de um gesto da pessoa (toque, clique). Resolve `false` se o navegador não deixou tocar. */
  ligar(): Promise<boolean>;
  desligar(): void;
  definirFontes(f: FontesDeSom): void;
  /** O ouvinte acompanha a câmera; `passaros` = de dia (à noite eles param). */
  quadro(camera: THREE.Camera, agoraS: number, passaros?: boolean): void;
  destruir(): void;
}

export function criarAmbienteSonoro(): AmbienteSonoro {
  let ctx: AudioContext | null = null;
  let mestre: GainNode | null = null;
  let rua: GainNode | null = null;
  let fontes: FontesDeSom = { arvores: [], agua: [] };
  const aguas: Array<{ no: AudioScheduledSourceNode; panner: PannerNode }> = [];
  const pararAguas: Array<() => void> = [];
  let ruido: AudioBuffer | null = null;
  let proximoCanto = 0;
  let semente = 12345;
  const rnd = () => {
    semente = (semente * 1664525 + 1013904223) >>> 0;
    return semente / 4294967296;
  };
  const frente = new THREE.Vector3();
  const cima = new THREE.Vector3();

  const panner = (c: AudioContext, x: number, y: number, z: number, ref = 4) => {
    const p = new PannerNode(c, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, maxDistance: 400, rolloffFactor: 1.2, positionX: x, positionY: y, positionZ: z });
    p.connect(mestre!);
    return p;
  };

  function montarAgua(): void {
    for (const parar of pararAguas.splice(0)) parar();
    aguas.length = 0;
    if (!ctx || !ruido) return;
    for (const a of fontes.agua) {
      const fonte = new AudioBufferSourceNode(ctx, { buffer: ruido, loop: true, playbackRate: 3.2 });
      const filtro = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1100, Q: 0.6 });
      const ganho = new GainNode(ctx, { gain: 0.5 });
      // marolinha: o volume sobe e desce devagar
      const onda = new OscillatorNode(ctx, { frequency: 0.25 });
      const fundo = new GainNode(ctx, { gain: 0.18 });
      onda.connect(fundo).connect(ganho.gain);
      const p = panner(ctx, a.x, a.y + 0.5, a.z, 3);
      fonte.connect(filtro).connect(ganho).connect(p);
      fonte.start();
      onda.start();
      aguas.push({ no: fonte, panner: p });
      pararAguas.push(() => {
        fonte.stop();
        onda.stop();
        p.disconnect();
      });
    }
  }

  function cantar(c: AudioContext, agora: number): void {
    const arvore = fontes.arvores[Math.floor(rnd() * fontes.arvores.length)];
    if (!arvore) return;
    const p = panner(c, arvore.x, arvore.altura * 0.8, arvore.z, 5);
    let t = agora;
    for (const nota of cantoDePassaro(rnd)) {
      const osc = new OscillatorNode(c, { type: 'sine', frequency: nota.de });
      osc.frequency.exponentialRampToValueAtTime(nota.ate, t + nota.duracaoS);
      const env = new GainNode(c, { gain: 0 });
      env.gain.linearRampToValueAtTime(0.16, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + nota.duracaoS);
      osc.connect(env).connect(p);
      osc.start(t);
      osc.stop(t + nota.duracaoS + 0.02);
      t += nota.duracaoS + nota.pausaS;
    }
    setTimeout(() => p.disconnect(), (t - agora + 0.5) * 1000);
  }

  return {
    ligado: () => ctx?.state === 'running' && (mestre?.gain.value ?? 0) > 0,
    async ligar() {
      try {
        if (!ctx) {
          ctx = new AudioContext();
          mestre = new GainNode(ctx, { gain: 0 });
          mestre.connect(ctx.destination);
          ruido = ruidoMarrom(ctx);
          // fundo da rua: ruído marrom grave, sem posição (vem de todo lado)
          const fonte = new AudioBufferSourceNode(ctx, { buffer: ruido, loop: true });
          const filtro = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 380 });
          rua = new GainNode(ctx, { gain: 0.15 });
          fonte.connect(filtro).connect(rua).connect(mestre);
          fonte.start();
          montarAgua();
        }
        await ctx.resume();
        mestre!.gain.setTargetAtTime(1, ctx.currentTime, 0.4); // entra suave
        return ctx.state === 'running';
      } catch {
        return false;
      }
    },
    desligar() {
      if (ctx && mestre) mestre.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => {
        if (ctx && mestre && mestre.gain.value < 0.01) void ctx.suspend();
      }, 800);
    },
    definirFontes(f) {
      fontes = f;
      montarAgua();
    },
    quadro(camera, agoraS, passaros = true) {
      if (!ctx || ctx.state !== 'running') return;
      const l = ctx.listener;
      camera.getWorldDirection(frente);
      cima.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const t = ctx.currentTime;
      if (l.positionX) {
        l.positionX.setValueAtTime(camera.position.x, t);
        l.positionY.setValueAtTime(camera.position.y, t);
        l.positionZ.setValueAtTime(camera.position.z, t);
        l.forwardX.setValueAtTime(frente.x, t);
        l.forwardY.setValueAtTime(frente.y, t);
        l.forwardZ.setValueAtTime(frente.z, t);
        l.upX.setValueAtTime(cima.x, t);
        l.upY.setValueAtTime(cima.y, t);
        l.upZ.setValueAtTime(cima.z, t);
      } else {
        l.setPosition(camera.position.x, camera.position.y, camera.position.z); // Safari antigo
        l.setOrientation(frente.x, frente.y, frente.z, cima.x, cima.y, cima.z);
      }
      rua?.gain.setTargetAtTime(volumeDaRua(camera.position.y), t, 0.5);
      // pássaros: de vez em quando, numa árvore qualquer (de dia; à noite o viewer não chama)
      if (passaros && agoraS >= proximoCanto) {
        cantar(ctx, t + 0.05);
        proximoCanto = agoraS + 1.2 + rnd() * 3;
      }
    },
    destruir() {
      for (const parar of pararAguas.splice(0)) parar();
      void ctx?.close();
      ctx = null;
    },
  };
}
