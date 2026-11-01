import * as THREE from 'three';
import type { Caixa } from '../units/tipos';
import { gestoDeDoisDedos, limitarEscala, montarMaquete, pontoDeEntrada, type Toque } from './maquete';

export type TipoXr = 'vr' | 'ar';

/** O que a sessão imersiva precisa do 3D (sem conhecer o resto do viewer). */
export interface ContextoXr {
  renderer: THREE.WebGLRenderer;
  cena: THREE.Scene;
  caixaDoPredio(): Caixa;
  /** Prédio (unidades, fachada, modelo) e paisagismo: o que vai para a maquete. */
  objetosDoPredio(): THREE.Object3D[];
  /** Onde dá para pisar (chão, lajes, peças sólidas): alvos do teleporte. */
  pisos(): THREE.Object3D[];
  /** Malhas das unidades e a unidade de cada uma: apontar e apertar abre a unidade. */
  unidades(): Map<THREE.Object3D, string>;
  aoSelecionar(id: string | null): void;
  /** A sessão acabou (o óculos saiu, a pessoa tocou em "Sair" ou o navegador encerrou). */
  aoTerminar(): void;
}

export interface SessaoXr {
  tipo: TipoXr;
  /** O que desenhar neste quadro (no AR é a cena da maquete, sem céu nem cidade). */
  cena: THREE.Scene;
  /** Chamado a cada quadro do óculos/câmera. */
  quadro(frame: XRFrame | undefined): void;
  encerrar(): Promise<void>;
}

const xr = (): XRSystem | undefined => (navigator as Navigator & { xr?: XRSystem }).xr;

/**
 * Passeio em tamanho real no óculos (Meta Quest e outros, pelo navegador). Começa no chão, de frente para o
 * prédio. Apontar o controle mostra o raio; soltar o gatilho num piso teleporta até lá; numa unidade, abre a
 * unidade. Precisa ser chamado direto no clique (o navegador exige o gesto da pessoa).
 */
export async function iniciarVr(ctx: ContextoXr): Promise<SessaoXr> {
  const pedido = xr()?.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
  if (!pedido) throw new Error('sem_webxr');
  const sessao = await pedido;
  const { renderer, cena } = ctx;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(sessao);
  const base = renderer.xr.getReferenceSpace();
  /** Leva a pessoa até (x, y, z) da cena, mantendo onde ela está dentro da sala. */
  const irPara = (p: { x: number; y: number; z: number }) => {
    if (!base) return;
    renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform({ x: -p.x, y: -p.y, z: -p.z, w: 1 })));
  };
  irPara(pontoDeEntrada(ctx.caixaDoPredio()));

  // raio do controle e marcador no chão
  const raio = new THREE.Raycaster();
  const materialRaio = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
  const geometriaRaio = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const marcador = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.32, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  marcador.visible = false;
  cena.add(marcador);
  const normal = new THREE.Vector3();
  type Alvo = { tipo: 'piso'; ponto: THREE.Vector3 } | { tipo: 'unidade'; id: string } | null;
  const mirar = (controle: THREE.XRTargetRaySpace): Alvo => {
    raio.setFromXRController(controle);
    raio.far = 80;
    const unidades = ctx.unidades();
    for (const h of raio.intersectObjects([...unidades.keys(), ...ctx.pisos()], false)) {
      const id = unidades.get(h.object);
      if (id) return { tipo: 'unidade', id };
      if (h.face && normal.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.7) return { tipo: 'piso', ponto: h.point.clone() };
      return null; // parede no caminho
    }
    return null;
  };
  // o three devolve o mesmo controle em toda sessão: tudo o que entra aqui sai no fim
  const controles: Array<{ controle: THREE.XRTargetRaySpace; apertado: boolean; linha: THREE.Line; inicio: () => void; fim: () => void }> = [];
  for (let i = 0; i < 2; i++) {
    const controle = renderer.xr.getController(i);
    const linha = new THREE.Line(geometriaRaio, materialRaio);
    linha.scale.z = 6;
    controle.add(linha);
    const estado = {
      controle,
      linha,
      apertado: false,
      inicio: () => (estado.apertado = true),
      fim: () => {
        estado.apertado = false;
        marcador.visible = false;
        const alvo = mirar(controle);
        if (alvo?.tipo === 'piso') irPara(alvo.ponto);
        else if (alvo?.tipo === 'unidade') ctx.aoSelecionar(alvo.id);
      },
    };
    controle.addEventListener('selectstart', estado.inicio);
    controle.addEventListener('selectend', estado.fim);
    cena.add(controle);
    controles.push(estado);
  }

  const limpar = () => {
    for (const { controle, linha, inicio, fim } of controles) {
      controle.removeEventListener('selectstart', inicio);
      controle.removeEventListener('selectend', fim);
      controle.remove(linha);
      cena.remove(controle);
    }
    cena.remove(marcador);
    geometriaRaio.dispose();
    materialRaio.dispose();
    marcador.geometry.dispose();
    (marcador.material as THREE.Material).dispose();
  };
  sessao.addEventListener('end', () => {
    limpar();
    ctx.aoTerminar();
  });

  return {
    tipo: 'vr',
    cena,
    quadro() {
      const apertado = controles.find((c) => c.apertado);
      const alvo = apertado ? mirar(apertado.controle) : null;
      marcador.visible = alvo?.tipo === 'piso';
      if (alvo?.tipo === 'piso') marcador.position.copy(alvo.ponto).setY(alvo.ponto.y + 0.02);
    },
    encerrar: () => sessao.end().catch(() => undefined),
  };
}

/**
 * Maquete na mesa pela câmera (Chrome no Android). Um anel mostra onde a mesa foi encontrada; tocar coloca (ou
 * muda de lugar) a maquete; dois dedos aumentam, diminuem e giram. `sobreposicao` é a camada da página que fica
 * por cima da câmera (botão de sair, dicas) e recebe os gestos.
 */
export async function iniciarAr(ctx: ContextoXr, sobreposicao: HTMLElement): Promise<SessaoXr> {
  const pedido = xr()?.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'local-floor'], domOverlay: { root: sobreposicao } });
  if (!pedido) throw new Error('sem_webxr');
  const sessao = await pedido;
  const { renderer } = ctx;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(sessao);
  const espacoDaTela = await sessao.requestReferenceSpace('viewer');
  const fonteDeMira = await sessao.requestHitTestSource?.({ space: espacoDaTela });

  // cena própria: só a maquete e a luz (o fundo é a câmera; céu, chão e cidade ficam de fora)
  const cena = new THREE.Scene();
  cena.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const sol = new THREE.DirectionalLight(0xffffff, 1.8);
  sol.position.set(0.5, 1, 0.3);
  cena.add(sol);
  const maquete = montarMaquete(ctx.objetosDoPredio());
  maquete.visible = false;
  cena.add(maquete);
  const base = maquete.scale.x;
  const anel = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  anel.matrixAutoUpdate = false;
  anel.visible = false;
  cena.add(anel);
  const recorteAntes = renderer.localClippingEnabled;
  renderer.localClippingEnabled = false; // o corte por andar é da escala real; a maquete aparece inteira

  // tocar coloca a maquete onde está o anel (o fim de uma pinça não conta como toque)
  let houveGesto = false;
  const colocar = () => {
    if (!anel.visible || houveGesto) return;
    maquete.position.setFromMatrixPosition(anel.matrix);
    maquete.visible = true;
  };
  const controle = renderer.xr.getController(0);
  controle.addEventListener('select', colocar);
  cena.add(controle);

  // dois dedos: pinça e giro (na camada da página, que recebe os toques por cima da câmera)
  const dedos = new Map<number, Toque>();
  let inicio: { a: Toque; b: Toque; escala: number; giro: number } | null = null;
  const pares = () => [...dedos.values()] as [Toque, Toque];
  const aoTocar = (e: PointerEvent) => {
    if (dedos.size === 0) houveGesto = false;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dedos.size === 2) {
      houveGesto = true;
      const [a, b] = pares();
      inicio = { a, b, escala: maquete.scale.x, giro: maquete.rotation.y };
    }
  };
  const aoMover = (e: PointerEvent) => {
    if (!dedos.has(e.pointerId)) return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dedos.size !== 2 || !inicio) return;
    const [a, b] = pares();
    const g = gestoDeDoisDedos(inicio.a, inicio.b, a, b);
    maquete.scale.setScalar(limitarEscala(inicio.escala * g.escala, base));
    maquete.rotation.y = inicio.giro - g.rotacao;
  };
  const aoSoltar = (e: PointerEvent) => {
    dedos.delete(e.pointerId);
    if (dedos.size < 2) inicio = null;
  };
  // tocar num botão da camada (Sair) não coloca a maquete
  const naoSelecionar = (e: Event) => {
    if (e.target instanceof Element && e.target.closest('button, a, input')) e.preventDefault();
  };
  sobreposicao.addEventListener('pointerdown', aoTocar);
  sobreposicao.addEventListener('pointermove', aoMover);
  sobreposicao.addEventListener('pointerup', aoSoltar);
  sobreposicao.addEventListener('pointercancel', aoSoltar);
  sobreposicao.addEventListener('beforexrselect', naoSelecionar);

  sessao.addEventListener('end', () => {
    sobreposicao.removeEventListener('pointerdown', aoTocar);
    sobreposicao.removeEventListener('pointermove', aoMover);
    sobreposicao.removeEventListener('pointerup', aoSoltar);
    sobreposicao.removeEventListener('pointercancel', aoSoltar);
    sobreposicao.removeEventListener('beforexrselect', naoSelecionar);
    fonteDeMira?.cancel();
    controle.removeEventListener('select', colocar);
    cena.remove(maquete);
    maquete.traverse((o) => o instanceof THREE.Mesh && (o.material as THREE.Material).userData.daMaquete && (o.material as THREE.Material).dispose());
    renderer.localClippingEnabled = recorteAntes;
    anel.geometry.dispose();
    (anel.material as THREE.Material).dispose();
    ctx.aoTerminar();
  });

  return {
    tipo: 'ar',
    cena,
    quadro(frame) {
      const espaco = renderer.xr.getReferenceSpace();
      const achado = fonteDeMira && frame && espaco ? frame.getHitTestResults(fonteDeMira)[0]?.getPose(espaco) : undefined;
      anel.visible = achado !== undefined;
      if (achado) anel.matrix.fromArray(achado.transform.matrix);
    },
    encerrar: () => sessao.end().catch(() => undefined),
  };
}
