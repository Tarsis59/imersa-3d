import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { ORIGEM_PAULISTA } from './geo/project';
import { sunDirection, horaSaoPauloParaUtc } from './sun/sun';
import { rumoDaCamera, paraReferenciaDoProjeto } from './sun/bussola';
import { massaDoPredio } from './units/massa';
import { buildCityMesh } from './city/cityMesh';
import { entornoParaLocal, type Entorno } from './city/entorno';
import { alturaDoCorte, planoDeCorte } from './units/corte';
import { COR_UNIDADE, type Caixa, type UnidadeViewer } from './units/tipos';
import { planejarVoo, enquadrar, type Pose } from './cameras/voo';
import { passoPrimeiraPessoa, bloqueioPorCaixas, type Entrada, type EstadoPessoa, type OpcoesPasso } from './cameras/primeiraPessoa';
import { QualidadeAdaptativa, type NivelQualidade } from './quality/adaptativa';

export type ModoCamera = 'orbita' | 'primeira-pessoa';

export interface ConfigViewer {
  unidades: UnidadeViewer[];
  /** GLB do prédio; sem ele, o prédio é desenhado em volumes (andares × unidades). */
  modeloUrl?: string | null;
  /** Para que rumo a frente (−z) do modelo aponta, em graus a partir do norte. */
  rotacaoGraus?: number;
  lat?: number;
  lon?: number;
  /** Índice do nível de qualidade inicial (0 = alto). */
  qualidadeInicial?: number;
}

export interface EstadoViewer {
  fps: number;
  nivel: NivelQualidade['nome'];
  rumo: number;
  modo: ModoCamera;
  posicao: { x: number; y: number; z: number };
}

export interface Viewer {
  /** Resolve quando o prédio está na tela; rejeita se o modelo não carregar. */
  pronto: Promise<void>;
  /** `passam` = unidades em destaque (as outras ficam esmaecidas); `null` = todas. */
  definirDestaque(passam: ReadonlySet<string> | null, favoritos: ReadonlySet<string>): void;
  /** Esconde o que está acima do andar. Devolve `false` se o andar não tem unidade no 3D. */
  cortarNoAndar(andar: number | null): boolean;
  andaresComCorte(): number[];
  voarPara(unidadeId: string): boolean;
  selecionar(unidadeId: string | null): void;
  definirModo(modo: ModoCamera): void;
  /** Entrada do joystick de toque (soma com o teclado). */
  definirEntrada(entrada: Entrada): void;
  definirSol(dataISO: string, hora: number): void;
  /** Prédios reais em volta (OSM). Devolve quantos foram desenhados. `null` tira o entorno. */
  definirEntorno(entorno: Entorno | null): Promise<number>;
  aoSelecionar(cb: (unidadeId: string | null) => void): void;
  aoMudar(cb: (estado: EstadoViewer) => void): void;
  destruir(): void;
}

interface PecaUnidade {
  unidade: UnidadeViewer;
  malha: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  caixa: Caixa;
}

const ALTURA_OLHOS_M = 1.6;
const VELOCIDADE_M_S = 2.2;
const DURACAO_VOO_MS = 1200;
const OPACIDADE_ESMAECIDA = 0.12;
const COR_SELECAO = 0x0369a1;
const COR_FAVORITA = 0x8a6d00;

const caixaDe = (b: THREE.Box3): Caixa => ({ minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z });

export function criarViewer(canvas: HTMLCanvasElement, config: ConfigViewer): Viewer {
  const rotacao = config.rotacaoGraus ?? 0;
  const lat = config.lat ?? ORIGEM_PAULISTA.lat;
  const lon = config.lon ?? ORIGEM_PAULISTA.lon;
  const qualidade = new QualidadeAdaptativa({ inicial: config.qualidadeInicial ?? 0 });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(qualidade.pixelRatio(window.devicePixelRatio));
  renderer.shadowMap.enabled = qualidade.nivel.sombras;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true; // o corte por andar vale só para o prédio, não para a cidade em volta

  const cena = new THREE.Scene();
  cena.background = new THREE.Color(0xbfd9f2);
  cena.fog = new THREE.Fog(0xbfd9f2, 700, 1800);
  const ceu = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.9);
  cena.add(ceu);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
  camera.position.set(60, 50, 60);
  const orbita = new OrbitControls(camera, canvas);
  orbita.enableDamping = true;
  orbita.maxPolarAngle = Math.PI / 2 - 0.03;

  const csm = new CSM({
    camera,
    parent: cena,
    cascades: 3,
    maxFar: 600,
    shadowMapSize: Math.max(qualidade.nivel.tamanhoSombra, 512),
    lightIntensity: 2.2,
    lightDirection: new THREE.Vector3(-1, -1, -1).normalize(),
  });
  const materiais = new Set<THREE.Material>();
  /** Materiais do empreendimento (recebem o corte por andar). */
  const materiaisPredio = new Set<THREE.Material>();
  const prepararMaterial = (m: THREE.Material, doPredio = false) => {
    if (doPredio) materiaisPredio.add(m);
    if (materiais.has(m)) return;
    materiais.add(m);
    csm.setupMaterial(m);
  };

  const chao = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0xd6d3cc }));
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  prepararMaterial(chao.material);
  cena.add(chao);

  const pecas = new Map<string, PecaUnidade>();
  /** Malhas que bloqueiam a primeira pessoa no modo GLB (paredes, lajes...). */
  const solidos: THREE.Object3D[] = [];
  let destaque: ReadonlySet<string> | null = null;
  let favoritos: ReadonlySet<string> = new Set();
  let selecionada: string | null = null;
  let corteY: number | null = null;
  let bloqueado: OpcoesPasso['bloqueado'] = () => false;
  let bloqueadoCidade: OpcoesPasso['bloqueado'] = () => false;
  let cidade: THREE.Mesh | null = null;
  const materialCidade = new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.9 });
  prepararMaterial(materialCidade);

  /** Bloqueio por raio horizontal na altura da cintura contra malhas reais (paredes com portas, prédios da cidade). */
  function bloqueioPorRaio(objetos: THREE.Object3D[]): OpcoesPasso['bloqueado'] {
    const raio = new THREE.Raycaster();
    const origem = new THREE.Vector3();
    const direcao = new THREE.Vector3();
    return (de, para) => {
      const distancia = Math.hypot(para.x - de.x, para.z - de.z);
      if (distancia === 0) return false;
      origem.set(de.x, ALTURA_OLHOS_M - 0.6, de.z);
      direcao.set(para.x - de.x, 0, para.z - de.z).normalize();
      raio.set(origem, direcao);
      raio.far = distancia + 0.3;
      return raio.intersectObjects(objetos, false).length > 0;
    };
  }

  function pintar(): void {
    for (const [id, p] of pecas) {
      const passa = destaque === null || destaque.has(id);
      p.material.color.setHex(COR_UNIDADE[p.unidade.status]);
      p.material.transparent = true;
      p.material.opacity = passa ? 0.92 : OPACIDADE_ESMAECIDA;
      p.material.depthWrite = passa;
      p.material.emissive.setHex(id === selecionada ? COR_SELECAO : favoritos.has(id) ? COR_FAVORITA : 0x000000);
      p.malha.castShadow = passa;
    }
  }

  function montarVolumes(): void {
    const porAndar = new Map<number, string[]>();
    for (const u of config.unidades) porAndar.set(u.andar, [...(porAndar.get(u.andar) ?? []), u.id]);
    const caixas = massaDoPredio([...porAndar].map(([numero, unidades]) => ({ numero, unidades })));
    const grupo = new THREE.Group();
    for (const u of config.unidades) {
      const c = caixas.get(u.id);
      if (!c) continue;
      const material = new THREE.MeshStandardMaterial({ roughness: 0.7 });
      prepararMaterial(material, true);
      const malha = new THREE.Mesh(new THREE.BoxGeometry(c.maxX - c.minX, c.maxY - c.minY, c.maxZ - c.minZ), material);
      malha.position.set((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
      malha.castShadow = true;
      malha.receiveShadow = true;
      grupo.add(malha);
      pecas.set(u.id, { unidade: u, malha, material, caixa: c });
    }
    cena.add(grupo);
    bloqueado = bloqueioPorCaixas([...caixas.values()], 0.3, ALTURA_OLHOS_M);
  }

  async function montarModelo(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const modelo = gltf.scene;
    const caixa = new THREE.Box3().setFromObject(modelo);
    const centro = caixa.getCenter(new THREE.Vector3());
    modelo.position.set(-centro.x, -caixa.min.y, -centro.z); // centralizado e apoiado no chão
    cena.add(modelo);
    modelo.updateMatrixWorld(true);
    const porNo = new Map(config.unidades.filter((u) => u.meshNodeId).map((u) => [u.meshNodeId!, u]));
    modelo.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      solidos.push(o);
      const unidade = o.name ? porNo.get(o.name) : undefined;
      if (unidade) {
        // material próprio: pintar uma unidade não pinta as outras peças que dividiam o material
        const original = Array.isArray(o.material) ? o.material[0] : o.material;
        const material = original instanceof THREE.MeshStandardMaterial ? original.clone() : new THREE.MeshStandardMaterial();
        o.material = material;
        prepararMaterial(material, true);
        pecas.set(unidade.id, { unidade, malha: o, material, caixa: caixaDe(new THREE.Box3().setFromObject(o)) });
      } else {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) prepararMaterial(m, true);
      }
    });
    bloqueado = bloqueioPorRaio(solidos);
  }

  function caixaDoPredio(): Caixa {
    const b = new THREE.Box3();
    for (const p of pecas.values()) b.union(new THREE.Box3(new THREE.Vector3(p.caixa.minX, p.caixa.minY, p.caixa.minZ), new THREE.Vector3(p.caixa.maxX, p.caixa.maxY, p.caixa.maxZ)));
    for (const s of solidos) b.union(new THREE.Box3().setFromObject(s));
    return b.isEmpty() ? { minX: -10, maxX: 10, minY: 0, maxY: 10, minZ: -10, maxZ: 10 } : caixaDe(b);
  }

  // -------------------------------------------------------------- câmera
  let modo: ModoCamera = 'orbita';
  let voo: { trajeto: (t: number) => Pose; inicio: number } | null = null;
  const pessoa: EstadoPessoa & { pitch: number } = { x: 0, z: 0, yaw: 0, pitch: 0 };
  const teclas = new Set<string>();
  let joystick: Entrada = { frente: 0, lado: 0 };

  function enquadrarPredio(): void {
    const pose = enquadrar(caixaDoPredio(), camera.fov, camera.aspect || 1, 30); // prédio inteiro: um pouco mais de cima
    camera.position.copy(pose.posicao);
    orbita.target.copy(pose.alvo);
    camera.far = Math.max(4000, pose.posicao.distanceTo(pose.alvo) * 10);
    camera.updateProjectionMatrix();
  }

  function definirModo(novo: ModoCamera): void {
    modo = novo;
    voo = null;
    orbita.enabled = novo === 'orbita';
    if (novo === 'primeira-pessoa') {
      const c = caixaDoPredio();
      // na calçada ao sul do prédio, olhando para ele (norte)
      Object.assign(pessoa, { x: (c.minX + c.maxX) / 2, z: c.maxZ + 6, yaw: 0, pitch: 0.15 });
    } else {
      enquadrarPredio();
    }
  }

  function entradaAtual(): Entrada {
    const t = (k: string) => (teclas.has(k) ? 1 : 0);
    return {
      frente: t('w') + t('arrowup') - t('s') - t('arrowdown') + joystick.frente,
      lado: t('d') + t('arrowright') - t('a') - t('arrowleft') + joystick.lado,
    };
  }

  const ehCampoDeTexto = (e: Event) => {
    const alvo = e.target as HTMLElement | null;
    return !!alvo && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName));
  };
  const aoTeclar = (e: KeyboardEvent) => {
    if (modo !== 'primeira-pessoa' || ehCampoDeTexto(e)) return;
    const k = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    e.preventDefault();
    teclas.add(k);
  };
  const aoSoltarTecla = (e: KeyboardEvent) => teclas.delete(e.key.toLowerCase());
  const aoPerderFoco = () => teclas.clear();

  // olhar arrastando (primeira pessoa) e clique em unidade (qualquer modo)
  let apertado: { x: number; y: number; ultX: number; ultY: number } | null = null;
  const aoApertar = (e: PointerEvent) => (apertado = { x: e.clientX, y: e.clientY, ultX: e.clientX, ultY: e.clientY });
  const aoMover = (e: PointerEvent) => {
    if (!apertado || modo !== 'primeira-pessoa') return;
    pessoa.yaw += (e.clientX - apertado.ultX) * 0.004;
    pessoa.pitch = THREE.MathUtils.clamp(pessoa.pitch + (e.clientY - apertado.ultY) * 0.004, -1.2, 1.2);
    apertado.ultX = e.clientX;
    apertado.ultY = e.clientY;
  };
  const raycaster = new THREE.Raycaster();
  const aoSoltar = (e: PointerEvent) => {
    const a = apertado;
    apertado = null;
    if (!a || Math.hypot(e.clientX - a.x, e.clientY - a.y) > 6) return; // foi arrasto
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const clicaveis = [...pecas.values()].filter((p) => (destaque === null || destaque.has(p.unidade.id)) && (corteY === null || p.caixa.minY < corteY));
    const alvo = raycaster.intersectObjects(clicaveis.map((p) => p.malha), false)[0];
    const id = alvo ? [...pecas.values()].find((p) => p.malha === alvo.object)?.unidade.id ?? null : null;
    selecionar(id);
    cbSelecao?.(id);
  };
  canvas.addEventListener('pointerdown', aoApertar);
  canvas.addEventListener('pointermove', aoMover);
  canvas.addEventListener('pointerup', aoSoltar);
  window.addEventListener('keydown', aoTeclar);
  window.addEventListener('keyup', aoSoltarTecla);
  window.addEventListener('blur', aoPerderFoco);

  function selecionar(id: string | null): void {
    selecionada = id && pecas.has(id) ? id : null;
    pintar();
  }

  // -------------------------------------------------------------- sol
  function definirSol(dataISO: string, hora: number): void {
    const mundo = sunDirection(horaSaoPauloParaUtc(dataISO, hora), lat, lon);
    const local = paraReferenciaDoProjeto(mundo, rotacao);
    csm.lightDirection.copy(local).negate();
    const dia = local.y > 0;
    for (const l of csm.lights) l.intensity = dia ? 2.2 : 0;
    ceu.intensity = dia ? 0.9 : 0.35;
  }

  function aplicarQualidade(n: NivelQualidade): void {
    renderer.setPixelRatio(qualidade.pixelRatio(window.devicePixelRatio));
    renderer.shadowMap.enabled = n.sombras;
    for (const l of csm.lights) {
      l.castShadow = n.sombras;
      if (n.sombras) {
        l.shadow.mapSize.set(n.tamanhoSombra, n.tamanhoSombra);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    }
    for (const m of materiais) m.needsUpdate = true;
  }

  // -------------------------------------------------------------- tamanho e laço
  const redimensionar = () => {
    const pai = canvas.parentElement ?? canvas;
    const w = Math.max(1, pai.clientWidth);
    const h = Math.max(1, pai.clientHeight);
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    csm.updateFrustums();
  };
  const observador = new ResizeObserver(redimensionar);
  observador.observe(canvas.parentElement ?? canvas);
  redimensionar();

  let cbSelecao: ((id: string | null) => void) | null = null;
  let cbMudanca: ((e: EstadoViewer) => void) | null = null;
  let ultimoQuadro = performance.now();
  let ultimoAviso = 0;
  const direcaoCamera = new THREE.Vector3();

  renderer.setAnimationLoop((agora: number) => {
    const dtMs = agora - ultimoQuadro;
    ultimoQuadro = agora;
    const troca = qualidade.registrar(dtMs);
    if (troca) aplicarQualidade(troca);

    if (voo) {
      const t = (agora - voo.inicio) / DURACAO_VOO_MS;
      const pose = voo.trajeto(t);
      camera.position.copy(pose.posicao);
      orbita.target.copy(pose.alvo);
      camera.lookAt(pose.alvo);
      if (t >= 1) {
        voo = null;
        orbita.enabled = modo === 'orbita';
      }
    } else if (modo === 'orbita') {
      orbita.update();
    } else {
      Object.assign(pessoa, passoPrimeiraPessoa(pessoa, entradaAtual(), Math.min(dtMs, 100) / 1000, { velocidade: VELOCIDADE_M_S, bloqueado: (de, para) => bloqueado(de, para) || bloqueadoCidade(de, para) }));
      camera.position.set(pessoa.x, ALTURA_OLHOS_M, pessoa.z);
      camera.rotation.set(pessoa.pitch, pessoa.yaw, 0, 'YXZ');
    }

    csm.update();
    renderer.render(cena, camera);

    if (cbMudanca && agora - ultimoAviso > 250) {
      ultimoAviso = agora;
      camera.getWorldDirection(direcaoCamera);
      cbMudanca({
        fps: Math.round(qualidade.fps),
        nivel: qualidade.nivel.nome,
        rumo: Math.round(rumoDaCamera(direcaoCamera, rotacao)),
        modo,
        posicao: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      });
    }
  });

  const pronto = (config.modeloUrl ? montarModelo(config.modeloUrl) : Promise.resolve(montarVolumes())).then(() => {
    pintar();
    enquadrarPredio();
  });
  definirSol(new Date().toISOString().slice(0, 10), 10);

  return {
    pronto,
    definirDestaque(passam, favs) {
      destaque = passam;
      favoritos = favs;
      pintar();
    },
    cortarNoAndar(andar) {
      const y = andar === null ? null : alturaDoCorte([...pecas.values()].map((p) => ({ andar: p.unidade.andar, caixa: p.caixa })), andar);
      corteY = y;
      const planos = y === null ? [] : [planoDeCorte(y + 0.01)];
      for (const m of materiaisPredio) {
        m.clippingPlanes = planos;
        m.needsUpdate = true;
      }
      return andar === null || y !== null;
    },
    andaresComCorte() {
      return [...new Set([...pecas.values()].map((p) => p.unidade.andar))].sort((a, b) => a - b);
    },
    voarPara(id) {
      const p = pecas.get(id);
      if (!p) return false;
      if (modo !== 'orbita') definirModo('orbita');
      orbita.enabled = false;
      voo = {
        trajeto: planejarVoo({ posicao: camera.position.clone(), alvo: orbita.target.clone() }, enquadrar(p.caixa, camera.fov, camera.aspect || 1, 20, 2.3)), // unidade com as vizinhas em volta
        inicio: performance.now(),
      };
      selecionar(id);
      return true;
    },
    selecionar,
    definirModo,
    definirEntrada(e) {
      joystick = e;
    },
    definirSol,
    async definirEntorno(entorno) {
      await pronto;
      if (cidade) {
        cena.remove(cidade);
        cidade.geometry.dispose();
        cidade = null;
      }
      bloqueadoCidade = () => false;
      if (!entorno) return 0;
      const predios = entornoParaLocal(entorno.predios, entorno.centro, rotacao, caixaDoPredio());
      if (predios.length === 0) return 0;
      cidade = buildCityMesh(predios, materialCidade);
      cidade.castShadow = true;
      cidade.receiveShadow = true;
      cena.add(cidade);
      bloqueadoCidade = bloqueioPorRaio([cidade]);
      return predios.length;
    },
    aoSelecionar(cb) {
      cbSelecao = cb;
    },
    aoMudar(cb) {
      cbMudanca = cb;
    },
    destruir() {
      renderer.setAnimationLoop(null);
      observador.disconnect();
      canvas.removeEventListener('pointerdown', aoApertar);
      canvas.removeEventListener('pointermove', aoMover);
      canvas.removeEventListener('pointerup', aoSoltar);
      window.removeEventListener('keydown', aoTeclar);
      window.removeEventListener('keyup', aoSoltarTecla);
      window.removeEventListener('blur', aoPerderFoco);
      orbita.dispose();
      csm.dispose();
      cena.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of materiais) m.dispose();
      renderer.dispose();
    },
  };
}
