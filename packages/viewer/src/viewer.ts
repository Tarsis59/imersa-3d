import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { lonLatToLocal, ORIGEM_PAULISTA } from './geo/project';
import { sunDirection, horaSaoPauloParaUtc } from './sun/sun';
import { criarCeu, type Clima } from './ambiente/ceu';
import type { PosProcessamento } from './ambiente/pos';
import { planejarPaisagismo } from './ambiente/paisagismo';
import { criarPaisagismo, VENTO, type Paisagismo } from './ambiente/vegetacao';
import { rumoDaCamera, paraReferenciaDoProjeto } from './sun/bussola';
import { massaDoPredio } from './units/massa';
import { ladoExterno, planejarFachada } from './units/fachada';
import { estudoSolar, type EstudoSolar, type FaceSolar } from './sun/insolacao';
import { malhasDaFachada, materiaisDaFachada, texturaDeJanelas } from './units/janelas';
import { buildCityMesh } from './city/cityMesh';
import { injetarFachada } from './city/fachadaCidade';
import { entornoParaLocal, type Entorno } from './city/entorno';
import { criarCidade, fita, paraModelo, terrenoDoRelevo, type CidadeCompleta } from './city/cidade';
import { montarDecorado, planejarDecorado, type Decorado, type EstiloDecorado } from './interior/decorado';
import { criarQuadros, planejarQuadros, type FotoNoLugar, type QuadrosDeFoto } from './ambiente/fotos';
import { cameraAtrasDoOmbro, CORRETORA, criarBoneco, presetBoneco, type Boneco } from './cameras/boneco';
import { alturaDoCorte, planoDeCorte } from './units/corte';
import { COR_UNIDADE, type Caixa, type StatusUnidade, type UnidadeViewer } from './units/tipos';
import { planejarVoo, enquadrar, type Pose } from './cameras/voo';
import { passoPrimeiraPessoa, bloqueioPorCaixas, seguirPiso, rumoAoAlvo, yawPara, entradaDoControle, type Entrada, type EstadoPessoa, type OpcoesPasso, type Ponto2D } from './cameras/primeiraPessoa';
import { QualidadeAdaptativa, type NivelQualidade } from './quality/adaptativa';
import { criarCarregadorGltf, type Decodificadores } from './carregador';
import { layoutMarca, textoDaMarca, type DadosMarca } from './captura/marca';
import { corDoIndice, poseNoGiro } from './giro/giro';
import { criarConfigurador, type Configurador, type FonteMovel, type Superficie } from './configurador/cena';
import type { Acabamento } from './configurador/padroes';
import { ajustarPose, type PoseMovel } from './configurador/moveis';
import { exportarUsdz, montarMaquete } from './xr/maquete';
import type { LuzDaFoto } from './captura/fotorrealista';
import { caminhoRetangular, criarPessoas, MORADORES_POR_NIVEL, planejarMoradores, type Pessoas } from './ambiente/pessoas';
import { criarAmbienteSonoro } from './ambiente/som';
import { criarMarcadoresLazer, placa, poseParaLazer, type MarcadoresLazer, type PontoLazer } from './ambiente/lazer';
import { iniciarAr, iniciarVr, type ContextoXr, type SessaoXr, type TipoXr } from './xr/sessao';

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
  /** Mantém o nível inicial (só mede o FPS). Para testes visuais. */
  qualidadeFixa?: boolean;
  /** Estilo do apartamento decorado gerado ao entrar numa unidade do prédio desenhado (sem modelo). */
  estiloDecorado?: EstiloDecorado;
  /** Pastas dos decodificadores Draco/KTX2 (Meshopt já vem embutido). */
  decodificadores?: Decodificadores;
  /** Liga o configurador (acabamentos por superfície e móveis). Só com modelo GLB. */
  configurador?: boolean;
}

export interface EstadoViewer {
  fps: number;
  nivel: NivelQualidade['nome'];
  rumo: number;
  modo: ModoCamera;
  posicao: { x: number; y: number; z: number };
  /** Acabamento de imagem (sombra de contato, brilho, antisserrilhado) ligado. */
  acabamento: boolean;
  /** Para onde a câmera olha no chão (x, z normalizados): seta do minimapa. */
  direcao: { x: number; z: number };
  /** Passeio no óculos (`vr`) ou maquete na mesa pela câmera (`ar`); `null` = tela normal. */
  imersivo: TipoXr | null;
  /** Moradores caminhando na calçada (0 no aparelho fraco e nas cenas de teste). */
  moradores: number;
  /** Som ambiente tocando. */
  som: boolean;
  /** Móveis do apartamento decorado em que a pessoa está (0 = fora, ou unidade sem decorado). */
  decorado: number;
  /** Pessoas da visita em grupo desenhadas no 3D. */
  outros: number;
  /** Rota a pé desenhada no chão (número de pontos; 0 = nenhuma). */
  rota: number;
  /** Etiquetas "Apto 1201" à vista (unidades filtradas). */
  etiquetas: number;
  /** Vista explodida: 0 = andares juntos, 1 = separados (no meio da animação, entre os dois). */
  explosao: number;
  /** Corretora virtual na tela (e se está falando). */
  corretora: 'fora' | 'parada' | 'falando';
  /** Modo jogo: câmera atrás do boneco (terceira pessoa). */
  terceiraPessoa: boolean;
  /** Boneco escolhido. */
  boneco: string;
  /** No ar (pulando). */
  noAr: boolean;
  correndo: boolean;
}

/** Resumo da visita para a telemetria. */
export interface MetricasViewer {
  /** Da criação até o prédio na tela; `null` se ainda não carregou. */
  cargaMs: number | null;
  /** Média da visita, sem contar travadas longas (aba em segundo plano). */
  fpsMedio: number | null;
  nivel: NivelQualidade['nome'];
  erros: number;
}

/** Giro 360° pré-renderizado: só imagens, para aparelho fraco. `unidades[i]` é a unidade da cor-ID i. */
export interface Giro {
  quadros: Array<{ cor: Blob; mascara: Blob }>;
  unidades: string[];
  largura: number;
  altura: number;
}

export type { Clima };

export interface Viewer {
  /** Resolve quando o prédio está na tela; rejeita se o modelo não carregar. */
  pronto: Promise<void>;
  /** `passam` = unidades em destaque (as outras ficam esmaecidas); `null` = todas. */
  definirDestaque(passam: ReadonlySet<string> | null, favoritos: ReadonlySet<string>): void;
  /** Status mudou (venda/reserva em tempo real): repinta a unidade. Devolve `false` se ela não está no 3D. */
  definirStatus(unidadeId: string, status: StatusUnidade): boolean;
  /** Esconde o que está acima do andar. Devolve `false` se o andar não tem unidade no 3D. */
  cortarNoAndar(andar: number | null): boolean;
  andaresComCorte(): number[];
  /**
   * Vista explodida (Plano 12c): separa os andares no alto, com animação; a casca do prédio sai e ficam as fatias
   * com as unidades pintadas pela situação. `false` junta de novo.
   */
  separarAndares(ligado: boolean): void;
  /**
   * Rota a pé desenhada no chão, do empreendimento até um ponto próximo (Plano 12a, item 11): pontos [lon, lat] pelas
   * ruas; a câmera voa para enquadrar o caminho todo. `null` apaga. `false` sem o entorno carregado.
   */
  desenharRota(pontos: ReadonlyArray<readonly [number, number]> | null): boolean;
  voarPara(unidadeId: string): boolean;
  selecionar(unidadeId: string | null): void;
  definirModo(modo: ModoCamera): void;
  /** Entrada do joystick de toque (soma com o teclado). */
  definirEntrada(entrada: Entrada): void;
  definirSol(dataISO: string, hora: number): void;
  /**
   * Horas de sol direto na fachada de cada unidade (verão, inverno, equinócio) e de que parte do dia vem, com a
   * sombra dos prédios reais em volta (depois do entorno). Unidades sem face externa ficam de fora.
   */
  estudoSolar(): Map<string, EstudoSolar>;
  /** Câmera na varanda (janela) da unidade, na altura dos olhos, olhando para fora; arrastar olha em volta. */
  vistaDaUnidade(unidadeId: string): boolean;
  /**
   * Primeira pessoa dentro da unidade (no piso dela, olhando para a janela). No prédio desenhado pela fachada, o vidro
   * da unidade fica claro por dentro. Sai com `definirModo` ou `visaoGeral`.
   */
  entrarNaUnidade(unidadeId: string): boolean;
  /** Onde está a câmera e para onde olha (tour guiado ao vivo: a consultora transmite). */
  poseCamera(): { posicao: [number, number, number]; alvo: [number, number, number] };
  /** Minimapa: o prédio, os prédios vizinhos até 150 m (caixas no chão, eixos da cena) e os pontos do lazer. */
  mapaDoLote(): { predio: Caixa; vizinhos: Caixa[]; lazer: Array<{ id: string; x: number; z: number }> };
  /** Lazer do empreendimento: marcadores com o nome (piscina, academia...). Lista vazia tira os marcadores. */
  definirLazer(pontos: readonly PontoLazer[]): void;
  /** Voa até o ponto do lazer, com ele em destaque (tour "Conheça o lazer"). */
  voarParaLazer(id: string): boolean;
  /**
   * Som ambiente (pássaros, rua, água da piscina), posicionado no espaço. Ligar precisa vir de um gesto da pessoa.
   * Resolve se ficou tocando.
   */
  definirSom(ligado: boolean): Promise<boolean>;
  /** Toque num marcador do lazer. */
  aoSelecionarLazer(cb: ((id: string) => void) | null): void;
  /** Modo jogo (a pé): câmera atrás do boneco (`true`) ou nos olhos (`false`), sem recarregar. */
  definirTerceiraPessoa(ligada: boolean): void;
  /** Troca o boneco (ana, beto, carla, davi). */
  definirBoneco(id: string): void;
  /** Pula (a pé, no chão). Devolve `false` se já está no ar ou fora do modo a pé. */
  pular(): boolean;
  /** Correr em vez de andar. */
  definirCorrida(ligada: boolean): void;
  /** O boneco acena por 2 s (visita em grupo, corretora virtual). */
  acenar(): void;
  /**
   * Corretora virtual: personagem na calçada em frente à unidade (ou à entrada do prédio, sem unidade), virada para
   * a câmera; acena enquanto `falando`. `null` tira a corretora.
   */
  mostrarCorretora(c: { unidadeId: string | null; falando: boolean } | null): void;
  /** Visita em grupo: os bonecos das outras pessoas na sala, nas posições que elas mandaram (andam suave até lá). */
  definirOutros(pessoas: ReadonlyArray<{ id: string; x: number; y: number; z: number; yaw: number; boneco: string }>): void;
  /** Minha posição a pé (para mandar à sala), ou `null` fora do modo a pé. */
  minhaPosicao(): { x: number; y: number; z: number; yaw: number; boneco: string } | null;
  /** Fotos do imóvel com GPS: quadros no 3D onde foram tiradas. Devolve quantos quadros ficaram (perto do prédio). */
  definirFotos(fotos: readonly FotoNoLugar[]): number;
  /** Põe a imagem (link assinado) no quadro da foto. */
  mostrarFoto(id: string, url: string): Promise<boolean>;
  /** Toque num quadro de foto (a tela abre a foto em tela cheia). */
  aoSelecionarFoto(cb: ((id: string) => void) | null): void;
  /** Segue a câmera de outra pessoa (cliente no tour guiado), suave; `null` devolve o controle. */
  seguirPose(pose: { posicao: [number, number, number]; alvo: [number, number, number] } | null): void;
  /**
   * Passeio em tamanho real no óculos de VR (WebXR). Chamar direto no clique. Resolve `false` se o aparelho não
   * abriu a sessão (sem óculos, recusado). Sai pelo óculos ou com `sairDoImersivo`.
   */
  entrarEmVr(): Promise<boolean>;
  /** Maquete na mesa pela câmera (WebXR AR, Chrome no Android). `sobreposicao` = camada da página por cima da câmera. */
  entrarEmAr(sobreposicao: HTMLElement): Promise<boolean>;
  sairDoImersivo(): Promise<void>;
  /** Maquete em USDZ para o AR do iPhone (Quick Look), com a situação atual das unidades. */
  arquivoUsdz(): Promise<Blob>;
  /** Céu limpo (sol e sombra fortes) ou nublado (luz difusa, céu cinza, sombra fraca). */
  definirClima(clima: Clima): void;
  /** Apresentação automática (estande sem ninguém mexendo): a câmera gira devagar em volta do prédio. */
  apresentacao(ligada: boolean): void;
  /** Volta à vista do prédio inteiro, em órbita (o estande recomeça para o próximo visitante). */
  visaoGeral(): void;
  /** Prédios reais em volta (OSM). Devolve quantos foram desenhados. `null` tira o entorno. */
  definirEntorno(entorno: Entorno | null): Promise<number>;
  /** PNG da vista atual com faixa da marca (empresa, prédio, data, "imagem ilustrativa" e atribuição do OSM). */
  capturar(dados: Omit<DadosMarca, 'atribuicao'>): Promise<Blob>;
  /**
   * Foto fotorrealista da vista atual por path tracing (luz, sombra suave e reflexos de render), "revelando" na
   * tela a cada amostra; depois, o PNG com a faixa da marca. O 3D fica parado enquanto isso. Rejeita se o
   * aparelho não tiver o que o path tracing precisa (aí vale o giro fotorrealista do Blender) ou se for cancelada.
   */
  fotoRealista(dados: Omit<DadosMarca, 'atribuicao'>, opcoes?: { amostras?: number; aoProgredir?: (feitas: number, total: number) => void; sinal?: AbortSignal }): Promise<Blob>;
  metricas(): MetricasViewer;
  /** Renderiza o giro 360° (quadros + máscaras de unidade por cor-ID) a partir da vista atual. */
  gerarGiro(opcoes?: { quadros?: number; aoProgredir?: (feitos: number, total: number) => void }): Promise<Giro>;
  /** Conta um erro de algo ligado ao 3D (entorno, interior...) na telemetria. */
  registrarErro(): void;
  /** Configurador: superfícies personalizáveis do modelo (vazio sem modelo GLB ou sem `configurador`). */
  superficies(): Superficie[];
  /**
   * Troca o acabamento de uma superfície (`null` = original). Resolve com os tempos em ms: `trabalhoMs` = o que a
   * troca custa (mudar o material), `ateQuadroMs` = até o quadro seguinte já desenhado com ele (inclui esperar e
   * desenhar o quadro). `null` se a superfície não existe.
   */
  definirAcabamento(chave: string, acabamento: Acabamento | null): Promise<{ trabalhoMs: number; ateQuadroMs: number } | null>;
  /**
   * Adianta o trabalho das trocas: UV das superfícies e texturas dos acabamentos já desenhadas e enviadas à placa
   * de vídeo, um pouco por quadro (a tela não trava). Depois disso, trocar só muda números.
   */
  prepararAcabamentos(acabamentos: readonly Acabamento[]): Promise<void>;
  /** Coloca (ou move, se já existe) um móvel; a pose vai para a grade de 5 cm. */
  colocarMovel(id: string, fonte: FonteMovel, pose: PoseMovel): Promise<PoseMovel>;
  moverMovel(id: string, pose: PoseMovel): PoseMovel | null;
  removerMovel(id: string): boolean;
  /** Enquanto houver callback, o clique num piso devolve o ponto (para colocar móvel) em vez de selecionar unidade. */
  aoClicarPiso(cb: ((ponto: { x: number; y: number; z: number }) => void) | null): void;
  /** Clique num móvel já colocado. */
  aoSelecionarMovel(cb: ((id: string) => void) | null): void;
  /** Piso logo abaixo de (x, z), procurando a partir de `deY` metros para baixo (colocar móvel sem clicar). */
  pisoAbaixo(x: number, z: number, deY?: number): { x: number; y: number; z: number } | null;
  aoSelecionar(cb: (unidadeId: string | null) => void): void;
  aoMudar(cb: (estado: EstadoViewer) => void): void;
  destruir(): void;
}

interface PecaUnidade {
  unidade: UnidadeViewer;
  malha: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  caixa: Caixa;
  /** Ambiente do BIM (IfcSpace): volume de ar, mostrado translúcido por cima das paredes. */
  ambiente?: boolean;
}

const ALTURA_OLHOS_M = 1.6;
const VELOCIDADE_M_S = 2.2;
/** Correndo (modo jogo). */
const CORRIDA_M_S = 4.5;
/** Impulso do pulo (~0,9 m de altura) e gravidade. */
const PULO_M_S = 4.2;
const GRAVIDADE = 9.8;
/** Distância da câmera atrás do boneco (na rua; dentro do apartamento, mais perto). */
const DISTANCIA_3A_M = 3.2;
const DISTANCIA_3A_DENTRO_M = 1.5;
/** Com a câmera mais perto que isso da cabeça (parede atrás), o boneco tapa a vista: some até ter espaço. */
const DISTANCIA_MIN_VER_BONECO_M = 0.75;
const DURACAO_VOO_MS = 1200;
/** Distância a mais entre um andar e o de cima na vista explodida. */
const ESPACO_EXPLOSAO_M = 3.5;
/** Até quantas unidades filtradas ganham etiqueta "Apto 1201" (mais que isso polui a fachada). */
const MAX_ETIQUETAS = 24;
const OPACIDADE_ESMAECIDA = 0.12;
const OPACIDADE_AMBIENTE = 0.45;
/** Tipo IFC que o conversor BIM grava em cada peça (extras do glTF → userData). */
const tipoIfc = (o: THREE.Object3D): string | undefined => (o.userData.ifc ?? o.parent?.userData.ifc) as string | undefined;
const COR_SELECAO = 0x0369a1;
const COR_FAVORITA = 0x8a6d00;

const caixaDe = (b: THREE.Box3): Caixa => ({ minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z });

export function criarViewer(canvas: HTMLCanvasElement, config: ConfigViewer): Viewer {
  const rotacao = config.rotacaoGraus ?? 0;
  const lat = config.lat ?? ORIGEM_PAULISTA.lat;
  const lon = config.lon ?? ORIGEM_PAULISTA.lon;
  // quem pediu menos movimento no aparelho: câmera vai direto (sem voo), nuvens paradas, giro do estande bem lento
  const menosMovimento = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duracaoVoo = menosMovimento ? 1 : DURACAO_VOO_MS;
  const qualidade = new QualidadeAdaptativa({ inicial: config.qualidadeInicial ?? 0, fixo: config.qualidadeFixa ?? false });
  const criadoEm = performance.now();
  let cargaMs: number | null = null;
  let erros = 0;
  let somaQuadrosMs = 0;
  let quadros = 0;

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
  // céu físico com nuvens e estrelas; o mapa de reflexos sai do próprio céu
  const atmosfera = criarCeu(renderer, cena);
  cena.add(atmosfera.objeto);

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

  // chão até além da neblina: no horizonte ele some na cor do céu, sem borda
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: 0xbebab1 }));
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  prepararMaterial(chao.material);
  cena.add(chao);

  const pecas = new Map<string, PecaUnidade>();
  /** Além das peças sólidas e do chão, onde dá para pisar (lajes da fachada procedural). */
  const pisosExtras: THREE.Object3D[] = [];
  /** Malhas que bloqueiam a primeira pessoa no modo GLB (paredes, lajes...). */
  const solidos: THREE.Object3D[] = [];
  let destaque: ReadonlySet<string> | null = null;
  let favoritos: ReadonlySet<string> = new Set();
  let selecionada: string | null = null;
  let corteY: number | null = null;
  let bloqueado: OpcoesPasso['bloqueado'] = () => false;
  let bloqueadoCidade: OpcoesPasso['bloqueado'] = () => false;
  let cidade: THREE.Mesh | null = null;
  /** Chão com relevo, ruas, verde, água e árvores de rua (Plano 11b). */
  let cidadeCompleta: CidadeCompleta | null = null;
  let atribuicaoEntorno: string | null = null;
  // cor de cada prédio vem do vértice (acabamento real); janelas e laje no shader (ver city/fachadaCidade)
  const materialCidade = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, vertexColors: true });
  const fachadaCidade = { noite: { value: 0 } };
  prepararMaterial(materialCidade);

  /**
   * Raio-x de visão: recorta os prédios da cidade que ficam entre a câmera e o empreendimento (cilindro em volta
   * da linha de visão), como em visualização de arquitetura. As sombras deles continuam (o mapa de sombra usa
   * outro material). Só na vista de cima; na primeira pessoa a cidade fica inteira.
   */
  const raioX = { camera: { value: new THREE.Vector3() }, alvo: { value: new THREE.Vector3() }, raio: { value: 0 } };
  const compilarCsm = materialCidade.onBeforeCompile;
  materialCidade.onBeforeCompile = (shader, r) => {
    compilarCsm.call(materialCidade, shader, r);
    shader.uniforms.uRaioXCamera = raioX.camera;
    shader.uniforms.uRaioXAlvo = raioX.alvo;
    shader.uniforms.uRaioXRaio = raioX.raio;
    injetarFachada(shader, fachadaCidade);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRaioXMundo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRaioXMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRaioXMundo;\nuniform vec3 uRaioXCamera;\nuniform vec3 uRaioXAlvo;\nuniform float uRaioXRaio;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (uRaioXRaio > 0.0) {
          vec3 linha = uRaioXAlvo - uRaioXCamera;
          float t = clamp(dot(vRaioXMundo - uRaioXCamera, linha) / dot(linha, linha), 0.0, 1.0);
          if (t < 0.98 && distance(vRaioXMundo, uRaioXCamera + t * linha) < uRaioXRaio) discard;
        }`,
      );
  };
  materialCidade.customProgramCacheKey = () => 'imersa-cidade-raiox-fachada';

  /** Bloqueio por raio horizontal na altura da cintura contra malhas reais (paredes com portas, prédios da cidade). */
  function bloqueioPorRaio(objetos: THREE.Object3D[]): OpcoesPasso['bloqueado'] {
    const raio = new THREE.Raycaster();
    const origem = new THREE.Vector3();
    const direcao = new THREE.Vector3();
    return (de, para) => {
      const distancia = Math.hypot(para.x - de.x, para.z - de.z);
      if (distancia === 0) return false;
      origem.set(de.x, (de.y ?? 0) + ALTURA_OLHOS_M - 0.6, de.z);
      direcao.set(para.x - de.x, 0, para.z - de.z).normalize();
      raio.set(origem, direcao);
      raio.far = distancia + 0.3;
      return raio.intersectObjects(objetos, false).length > 0;
    };
  }

  /** 0 de dia → 1 à noite: janelas acesas nas unidades (só no prédio desenhado pela fachada procedural). */
  let luzNoturna = 0;
  const LUZ_JANELA = 0xffb46b;
  /**
   * Unidade com luz acesa à noite (~60%), pelo código da unidade (fixo; o id muda a cada banco e a foto da noite
   * nunca saía igual): o prédio parece habitado sem piscar.
   */
  const acesaANoite = (id: string) => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h) % 10 < 6;
  };

  function pintar(): void {
    for (const [id, p] of pecas) {
      const passa = destaque === null || destaque.has(id);
      const dentroDela = id === interior;
      p.material.color.setHex(dentroDela ? 0xe4ecf2 : COR_UNIDADE[p.unidade.status]);
      p.material.transparent = true;
      p.material.opacity = dentroDela ? 0.3 : passa ? (p.ambiente ? OPACIDADE_AMBIENTE : 0.92) : OPACIDADE_ESMAECIDA;
      p.material.depthWrite = passa && !p.ambiente && !dentroDela;
      const lado = dentroDela ? THREE.DoubleSide : THREE.FrontSide; // por dentro, o vidro também aparece
      if (p.material.side !== lado) {
        p.material.side = lado;
        p.material.needsUpdate = true;
      }
      const marcada = id === selecionada ? COR_SELECAO : favoritos.has(id) ? COR_FAVORITA : null;
      // à noite, janelas acesas (luz quente atrás do vidro; os caixilhos da textura continuam escuros)
      const acesa = marcada === null && luzNoturna > 0 && p.material.map !== null && (p.unidade.status === 'disponivel' || acesaANoite(`${p.unidade.andar}:${p.unidade.codigo}`));
      if (marcada !== null || !acesa) p.material.emissive.setHex(marcada ?? 0x000000);
      // luz quente puxada para a cor da situação: à noite continua dando para ver o que está à venda
      else p.material.emissive.setHex(LUZ_JANELA).lerp(new THREE.Color(COR_UNIDADE[p.unidade.status]), 0.45);
      const mapa = acesa ? p.material.map : null;
      if (p.material.emissiveMap !== mapa) {
        p.material.emissiveMap = mapa;
        p.material.needsUpdate = true; // muda o shader só quando acende ou apaga
      }
      p.material.emissiveIntensity = acesa ? luzNoturna * 0.85 : 1;
      p.malha.castShadow = passa;
    }
  }

  function montarVolumes(): void {
    const porAndar = new Map<number, string[]>();
    for (const u of config.unidades) porAndar.set(u.andar, [...(porAndar.get(u.andar) ?? []), u.id]);
    const caixas = massaDoPredio([...porAndar].map(([numero, unidades]) => ({ numero, unidades })));
    const grupo = new THREE.Group();
    // cada unidade é um pano de vidro com caixilhos (tingido pela situação); em volta, a fachada de verdade
    const janelas = texturaDeJanelas();
    for (const u of config.unidades) {
      const c = caixas.get(u.id);
      if (!c) continue;
      const material = new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0.2, map: janelas });
      prepararMaterial(material, true);
      const malha = new THREE.Mesh(new THREE.BoxGeometry(c.maxX - c.minX, c.maxY - c.minY, c.maxZ - c.minZ), material);
      malha.position.set((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
      malha.castShadow = true;
      malha.receiveShadow = true;
      grupo.add(malha);
      pecas.set(u.id, { unidade: u, malha, material, caixa: c });
    }
    const materiaisFachada = materiaisDaFachada();
    for (const m of Object.values(materiaisFachada)) prepararMaterial(m, true);
    for (const malha of malhasDaFachada(planejarFachada(caixas.values()), materiaisFachada)) {
      grupo.add(malha);
      if (malha.name === 'fachada-concreto') pisosExtras.push(malha); // lajes: dá para pisar
    }
    cena.add(grupo);
    raizPredio = grupo;
    bloqueado = bloqueioPorCaixas([...caixas.values()], 0.3, ALTURA_OLHOS_M);
  }

  /** O empreendimento na cena (volumes com fachada ou o modelo GLB): vai para a maquete do AR. */
  let raizPredio: THREE.Object3D | null = null;
  let configurador: Configurador | null = null;
  let planosCorte: THREE.Plane[] = [];

  async function montarModelo(url: string): Promise<void> {
    const { carregador, liberar } = criarCarregadorGltf(renderer, config.decodificadores);
    const gltf = await carregador.loadAsync(url).finally(liberar);
    const modelo = gltf.scene;
    const caixa = new THREE.Box3().setFromObject(modelo);
    const centro = caixa.getCenter(new THREE.Vector3());
    modelo.position.set(-centro.x, -caixa.min.y, -centro.z); // centralizado e apoiado no chão
    cena.add(modelo);
    raizPredio = modelo;
    modelo.updateMatrixWorld(true);
    const porNo = new Map(config.unidades.filter((u) => u.meshNodeId).map((u) => [u.meshNodeId!, u]));
    modelo.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const unidade = o.name ? porNo.get(o.name) : undefined;
      const ambiente = tipoIfc(o) === 'IfcSpace';
      if (ambiente && !unidade) {
        // ambiente sem unidade: é só ar; não aparece nem bloqueia quem anda a pé
        o.visible = false;
        return;
      }
      o.castShadow = !ambiente;
      o.receiveShadow = true;
      if (!ambiente) solidos.push(o);
      if (unidade) {
        // material próprio: pintar uma unidade não pinta as outras peças que dividiam o material
        const original = Array.isArray(o.material) ? o.material[0] : o.material;
        const material = original instanceof THREE.MeshStandardMaterial ? original.clone() : new THREE.MeshStandardMaterial();
        o.material = material;
        prepararMaterial(material, true);
        pecas.set(unidade.id, { unidade, malha: o, material, caixa: caixaDe(new THREE.Box3().setFromObject(o)), ambiente });
      } else {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) prepararMaterial(m, true);
      }
    });
    bloqueado = bloqueioPorRaio(solidos);
    if (config.configurador) {
      configurador = criarConfigurador(modelo, cena, new Set([...pecas.values()].map((p) => p.malha)), {
        prepararMaterial: (m) => {
          prepararMaterial(m, true);
          m.clippingPlanes = planosCorte;
        },
        tipoIfc,
        async carregarGltf(u) {
          const c = criarCarregadorGltf(renderer, config.decodificadores);
          return (await c.carregador.loadAsync(u).finally(c.liberar)).scene;
        },
      });
    }
  }

  // gramado, calçada, árvores e postes em volta do lote (refeito quando chegam os prédios vizinhos)
  let paisagismo: Paisagismo | null = null;
  function montarPaisagismo(): void {
    if (paisagismo) {
      cena.remove(paisagismo.objeto);
      for (const m of paisagismo.materiais) materiais.delete(m);
      paisagismo.destruir();
    }
    const plano = planejarPaisagismo(caixaDoPredio(), obstaculos);
    paisagismo = criarPaisagismo(plano, (m) => prepararMaterial(m));
    paisagismo.definirNoite(luzNoturna);
    cena.add(paisagismo.objeto);
    arvoresDoLote = plano.arvores;
    som.definirFontes({ arvores: arvoresDoLote, agua: aguaDoLazer() });
    // moradores caminhando no meio da calçada (fora das cenas de teste, que precisam sair sempre iguais)
    if (pessoas) {
      cena.remove(pessoas.objeto);
      for (const m of pessoas.materiais) materiais.delete(m);
      pessoas.destruir();
      pessoas = null;
    }
    if (!config.qualidadeFixa) {
      const caminho = caminhoRetangular(plano.calcada, 1.5);
      pessoas = criarPessoas(caminho, planejarMoradores(MORADORES_POR_NIVEL.alto, caminho.comprimento), (m) => prepararMaterial(m));
      pessoas.definirQuantidade(MORADORES_POR_NIVEL[qualidade.nivel.nome]);
      cena.add(pessoas.objeto);
    }
  }
  let pessoas: Pessoas | null = null;
  let arvoresDoLote: ReadonlyArray<{ x: number; z: number; altura: number }> = [];
  const som = criarAmbienteSonoro();
  const aguaDoLazer = () => pontosLazer.filter((p) => p.agua).map((p) => ({ x: p.x, y: p.y, z: p.z }));

  function caixaDoPredio(): Caixa {
    const b = new THREE.Box3();
    for (const p of pecas.values()) b.union(new THREE.Box3(new THREE.Vector3(p.caixa.minX, p.caixa.minY, p.caixa.minZ), new THREE.Vector3(p.caixa.maxX, p.caixa.maxY, p.caixa.maxZ)));
    for (const s of solidos) b.union(new THREE.Box3().setFromObject(s));
    return b.isEmpty() ? { minX: -10, maxX: 10, minY: 0, maxY: 10, minZ: -10, maxZ: 10 } : caixaDe(b);
  }

  // -------------------------------------------------------------- câmera
  let modo: ModoCamera = 'orbita';
  let voo: { trajeto: (t: number) => Pose; inicio: number } | null = null;
  const pessoa: EstadoPessoa & { pitch: number; y: number } = { x: 0, z: 0, y: 0, yaw: 0, pitch: 0 };
  /** Tocar no chão para ir (primeira pessoa). */
  let alvoCaminhada: Ponto2D | null = null;
  let paradoMs = 0;
  /** Tour guiado ao vivo: a câmera segue a da consultora. */
  let poseSeguida: { posicao: THREE.Vector3; alvo: THREE.Vector3 } | null = null;
  /** Unidade onde a pessoa entrou (vidro claro por dentro). */
  let interior: string | null = null;
  /** Apartamento decorado gerado (prédio desenhado, sem modelo): móveis e paredes internas da unidade. */
  let decorado: Decorado | null = null;
  let bloqueadoDecorado: OpcoesPasso['bloqueado'] = () => false;
  function tirarDecorado(): void {
    if (!decorado) return;
    cena.remove(decorado.objeto);
    decorado.objeto.traverse((o) => {
      if (o instanceof THREE.Mesh) materiais.delete(o.material as THREE.MeshStandardMaterial);
    });
    decorado.destruir();
    decorado = null;
    bloqueadoDecorado = () => false;
  }
  const raioPiso = new THREE.Raycaster();
  const baixo = new THREE.Vector3(0, -1, 0);
  /** Altura do piso sob (x, z), procurando de `deY` para baixo (peças sólidas, lajes e chão). */
  function alturaDoPiso(x: number, z: number, deY: number): number | null {
    raioPiso.set(new THREE.Vector3(x, deY, z), baixo);
    for (const h of raioPiso.intersectObjects([...solidos, chao, ...pisosExtras], false)) {
      if (!h.face) continue;
      if (normalMundo.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.7) return h.point.y;
    }
    return null;
  }
  const teclas = new Set<string>();
  let joystick: Entrada = { frente: 0, lado: 0 };

  function enquadrarPredio(): void {
    const pose = enquadrar(caixaDoPredio(), camera.fov, camera.aspect || 1, 30); // prédio inteiro: um pouco mais de cima
    camera.position.copy(pose.posicao);
    orbita.target.copy(pose.alvo);
    camera.far = Math.max(4000, pose.posicao.distanceTo(pose.alvo) * 10);
    camera.updateProjectionMatrix();
  }

  /** Sai da vista da janela: lente, zoom e distâncias da órbita voltam ao normal. */
  function sairDaVista(): void {
    if (!emVista) return;
    emVista = false;
    camera.fov = 50;
    camera.updateProjectionMatrix();
    orbita.enableZoom = true;
    orbita.enablePan = true;
    orbita.minDistance = 0;
    orbita.maxDistance = Infinity;
  }

  /** Câmera nos olhos da pessoa (a tela recebe a posição certa já no aviso, sem esperar o quadro). */
  // modo jogo: boneco em terceira pessoa, pulo e corrida
  let terceiraPessoa = false;
  let boneco: Boneco | null = null;
  let presetId = 'ana';
  let correndo = false;
  let velocidadeVertical = 0;
  let noAr = false;
  let pedidoPulo = false;
  let acenarAte = 0;
  /** Andado no último quadro (anima o passo do boneco). */
  let andadoQuadro = 0;
  let tempoQuadro = 0;
  const raioCamera = new THREE.Raycaster();
  const outros = new Map<string, { b: Boneco; alvo: { x: number; y: number; z: number; yaw: number }; atual: { x: number; y: number; z: number; yaw: number } }>();
  let corretora: Boneco | null = null;
  let corretoraFalando = false;
  let corretoraPos = { x: 0, z: 0 };
  function garantirBoneco(): Boneco {
    if (!boneco) {
      boneco = criarBoneco(presetBoneco(presetId), (m) => prepararMaterial(m));
      cena.add(boneco.objeto);
    }
    return boneco;
  }
  function posicionarPessoa(): void {
    if (!terceiraPessoa || modo !== 'primeira-pessoa') {
      if (boneco) boneco.objeto.visible = false;
      camera.position.set(pessoa.x, pessoa.y + ALTURA_OLHOS_M, pessoa.z);
      camera.rotation.set(pessoa.pitch, pessoa.yaw, 0, 'YXZ');
      return;
    }
    const b = garantirBoneco();
    b.objeto.visible = true;
    const agora = performance.now();
    b.atualizar(
      { x: pessoa.x, y: pessoa.y, z: pessoa.z, yaw: pessoa.yaw },
      { distancia: andadoQuadro, velocidade: tempoQuadro > 0 ? andadoQuadro / tempoQuadro : 0, noAr, acenando: agora < acenarAte ? 1 : 0 },
      agora / 1000,
      menosMovimento,
    );
    andadoQuadro = 0;
    tempoQuadro = 0;
    const desejo = interior ? DISTANCIA_3A_DENTRO_M : DISTANCIA_3A_M;
    const c = cameraAtrasDoOmbro(pessoa, desejo);
    // parede entre a cabeça e a câmera: a câmera encosta (não atravessa prédio nem parede do apartamento)
    const dir = c.posicao.clone().sub(c.cabeca);
    const dist = dir.length();
    raioCamera.set(c.cabeca, dir.normalize());
    raioCamera.far = dist;
    const barreiras = [...solidos, ...(cidade ? [cidade] : []), ...(decorado ? decorado.paredes : []), ...(interior ? [pecas.get(interior)?.malha].filter((x): x is THREE.Mesh => !!x) : [])];
    const bate = raioCamera.intersectObjects(barreiras, false)[0];
    const livre = bate ? Math.max(0.3, bate.distance - 0.2) : dist;
    if (bate) c.posicao.copy(c.cabeca).addScaledVector(dir, livre);
    // sem espaço para a câmera (cômodo pequeno): o boneco sai da frente, como nos jogos, e volta quando há espaço
    b.objeto.visible = livre >= DISTANCIA_MIN_VER_BONECO_M;
    camera.position.copy(c.posicao);
    camera.lookAt(c.alvo);
  }

  /**
   * Etiquetas "Apto 1201" em cima das unidades que passaram no filtro (Plano 12b, como no buscador do vídeo de Milão).
   * Presas à malha da unidade: acompanham a vista explodida. Com muitas unidades no filtro, nenhuma (viraria ruído).
   */
  const rotulos = new Map<string, THREE.Sprite>();
  function rotularUnidades(passam: ReadonlySet<string> | null): void {
    for (const s of rotulos.values()) {
      s.removeFromParent();
      (s.material as THREE.SpriteMaterial).map?.dispose();
      s.material.dispose();
    }
    rotulos.clear();
    if (!passam || passam.size === 0 || passam.size > MAX_ETIQUETAS) return;
    for (const id of passam) {
      const p = pecas.get(id);
      if (!p) continue;
      const s = placa(`Apto ${p.unidade.codigo}`);
      s.scale.multiplyScalar(0.8);
      p.malha.updateMatrixWorld();
      s.position.copy(p.malha.worldToLocal(new THREE.Vector3((p.caixa.minX + p.caixa.maxX) / 2, p.caixa.maxY + 0.6, (p.caixa.minZ + p.caixa.maxZ) / 2)));
      p.malha.add(s);
      rotulos.set(id, s);
    }
    ultimoAviso = 0;
  }

  /** Centro do entorno carregado (a rota a pé chega em lon/lat e vira chão do 3D por ele). */
  let centroEntorno: { lon: number; lat: number } | null = null;
  let rotaDesenhada: THREE.Group | null = null;
  function apagarRota(): void {
    if (!rotaDesenhada) return;
    rotaDesenhada.removeFromParent();
    rotaDesenhada.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    rotaDesenhada = null;
    ultimoAviso = 0;
  }

  /** Vista explodida: `atual` anda até `alvo` a cada quadro. */
  const explosao = { atual: 0, alvo: 0 };
  function aplicarExplosao(f: number): void {
    const andares = [...new Set([...pecas.values()].map((p) => p.unidade.andar))].sort((a, b) => a - b);
    const ordem = new Map(andares.map((a, i) => [a, i]));
    const unidades = new Set<THREE.Object3D>();
    for (const p of pecas.values()) {
      unidades.add(p.malha);
      const base = (p.malha.userData.ySemExplosao ??= p.malha.position.y) as number;
      p.malha.position.y = base + (ordem.get(p.unidade.andar) ?? 0) * ESPACO_EXPLOSAO_M * f;
    }
    // a casca (lajes, pilares, varandas, paredes do modelo) sai enquanto os andares estão separados
    raizPredio?.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || unidades.has(o)) return;
      if (f > 0.001) {
        o.userData.visivelSemExplosao ??= o.visible;
        o.visible = false;
      } else if (o.userData.visivelSemExplosao !== undefined) {
        o.visible = o.userData.visivelSemExplosao as boolean;
        delete o.userData.visivelSemExplosao;
      }
    });
    ultimoAviso = 0;
  }

  function definirModo(novo: ModoCamera): void {
    if (novo !== 'orbita' && explosao.atual > 0) {
      // andar a pé ou entrar no apartamento pede o prédio inteiro
      explosao.alvo = explosao.atual = 0;
      aplicarExplosao(0);
    }
    sairDaVista();
    modo = novo;
    voo = null;
    orbita.enabled = novo === 'orbita';
    if (boneco) boneco.objeto.visible = novo === 'primeira-pessoa' && terceiraPessoa;
    noAr = false;
    velocidadeVertical = 0;
    alvoCaminhada = null;
    if (interior) {
      interior = null;
      tirarDecorado();
      pintar();
    }
    if (novo === 'primeira-pessoa') {
      const c = caixaDoPredio();
      // na calçada ao sul do prédio, olhando para ele (norte)
      Object.assign(pessoa, { x: (c.minX + c.maxX) / 2, z: c.maxZ + 6, y: 0, yaw: 0, pitch: 0.15 });
      posicionarPessoa();
    } else {
      enquadrarPredio();
    }
    // a tela sabe do novo modo na hora (não espera o próximo quadro, que no aparelho lento pode demorar)
    ultimoAviso = 0;
    avisar(performance.now());
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
    if (k === ' ') {
      e.preventDefault();
      pedidoPulo = true;
      return;
    }
    if (k === 'shift') correndo = true;
    if (k === 'v' && !e.repeat) {
      terceiraPessoa = !terceiraPessoa;
      ultimoAviso = 0;
    }
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    e.preventDefault();
    teclas.add(k);
  };
  const aoSoltarTecla = (e: KeyboardEvent) => {
    if (e.key === 'Shift') correndo = false;
    teclas.delete(e.key.toLowerCase());
  };
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
  let cbPiso: ((p: { x: number; y: number; z: number }) => void) | null = null;
  let cbMovel: ((id: string) => void) | null = null;
  let cbLazer: ((id: string) => void) | null = null;
  let cbFoto: ((id: string) => void) | null = null;
  /** Fotos com GPS (quadrosFoto); refeitos quando o relevo chega (o poste fica no chão de verdade). */
  let fotosNoLugar: FotoNoLugar[] = [];
  let quadrosFoto: QuadrosDeFoto | null = null;
  const imagensDosQuadros = new Map<string, string>();
  function montarQuadros(): number {
    if (quadrosFoto) {
      cena.remove(quadrosFoto.objeto);
      quadrosFoto.destruir();
      quadrosFoto = null;
    }
    if (!fotosNoLugar.length || config.lat === undefined || config.lon === undefined) return 0;
    const planos = planejarQuadros(fotosNoLugar, { lat: config.lat, lon: config.lon }, rotacao, caixaDoPredio());
    if (!planos.length) return 0;
    const altura = cidadeCompleta ? cidadeCompleta.terreno.altura : () => 0;
    quadrosFoto = criarQuadros(planos, altura, (m) => prepararMaterial(m));
    cena.add(quadrosFoto.objeto);
    for (const [id, url] of imagensDosQuadros) void quadrosFoto.definirImagem(id, url);
    return quadrosFoto.quantos;
  }
  /** Lazer do empreendimento (marcadores no 3D). */
  let marcadores: MarcadoresLazer | null = null;
  let pontosLazer: readonly PontoLazer[] = [];
  const normalMundo = new THREE.Vector3();
  const aoSoltar = (e: PointerEvent) => {
    const a = apertado;
    apertado = null;
    if (!a || Math.hypot(e.clientX - a.x, e.clientY - a.y) > 6) return; // foi arrasto
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    if (configurador) {
      const movel = configurador.movelDoObjeto(raycaster.intersectObjects(configurador.objetosMoveis(), true)[0]?.object ?? null);
      if (movel && cbMovel) {
        cbMovel(movel);
        return;
      }
    }
    if (cbPiso) {
      // colocar móvel ou marcar o lazer: primeiro acerto em peça sólida, laje ou chão; vale se a face estiver virada
      // para cima (piso, laje, terreno, terraço)
      const acerto = raycaster.intersectObjects([...solidos, chao, ...pisosExtras], false).find((h) => !corteY || h.point.y <= corteY + 0.01);
      if (acerto?.face) {
        normalMundo.copy(acerto.face.normal).transformDirection(acerto.object.matrixWorld);
        if (normalMundo.y > 0.7) cbPiso({ x: acerto.point.x, y: acerto.point.y, z: acerto.point.z });
      }
      return;
    }
    if (quadrosFoto && cbFoto) {
      const foto = quadrosFoto.idDe(raycaster.intersectObjects(quadrosFoto.clicaveis(), false)[0]?.object ?? null);
      if (foto) {
        cbFoto(foto);
        return;
      }
    }
    if (marcadores && cbLazer) {
      const lazer = marcadores.idDe(raycaster.intersectObjects(marcadores.clicaveis(), false)[0]?.object ?? null);
      if (lazer) {
        cbLazer(lazer);
        return;
      }
    }
    if (modo === 'primeira-pessoa') {
      // tocar no chão: caminha até lá (se não houver unidade mais perto no mesmo toque)
      const chaoTocado = raycaster.intersectObjects([...solidos, chao, ...pisosExtras], false).find((h) => {
        if (!h.face) return false;
        return normalMundo.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.7;
      });
      const unidadeTocada = raycaster.intersectObjects([...pecas.values()].map((p) => p.malha), false)[0];
      if (chaoTocado && chaoTocado.distance < 60 && (!unidadeTocada || chaoTocado.distance < unidadeTocada.distance || interior !== null)) {
        alvoCaminhada = { x: chaoTocado.point.x, z: chaoTocado.point.z };
        paradoMs = 0;
        return;
      }
    }
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

  /** Faixa da marca embaixo da imagem que está no canvas agora (copiar na mesma tarefa em que ela foi desenhada). */
  function comMarca(dados: Omit<DadosMarca, 'atribuicao'>): Promise<Blob> {
    const w = canvas.width;
    const h = canvas.height;
    const l = layoutMarca(w, h);
    const tela = document.createElement('canvas');
    tela.width = w;
    tela.height = l.alturaTotal;
    const ctx = tela.getContext('2d');
    if (!ctx) return Promise.reject(new Error('Sem suporte a canvas 2D'));
    ctx.drawImage(canvas, 0, 0);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, h, w, l.alturaFaixa);
    const t = textoDaMarca({ ...dados, atribuicao: atribuicaoEntorno });
    const y = t.rodape ? h + l.alturaFaixa * 0.38 : h + l.alturaFaixa / 2;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${l.fonte}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(t.esquerda, l.margem, y, w * 0.58);
    ctx.font = `${l.fonte}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(t.direita, w - l.margem, y, w * 0.38);
    if (t.rodape) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = `${Math.max(9, Math.round(l.fonte * 0.75))}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(t.rodape, l.margem, h + l.alturaFaixa * 0.76, w - 2 * l.margem);
    }
    return new Promise((ok, erro) => tela.toBlob((b) => (b ? ok(b) : erro(new Error('Falha ao gerar o PNG'))), 'image/png'));
  }

  // -------------------------------------------------------------- VR e AR
  let imersiva: SessaoXr | null = null;
  let antesDoImersivo: { posicao: THREE.Vector3; alvo: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
  const contextoXr = (): ContextoXr => ({
    renderer,
    cena,
    caixaDoPredio,
    objetosDoPredio: () => [raizPredio, paisagismo?.objeto].filter((o): o is THREE.Object3D => o != null),
    pisos: () => [chao, ...pisosExtras, ...solidos],
    unidades: () => new Map([...pecas].map(([id, p]) => [p.malha as THREE.Object3D, id])),
    aoSelecionar(id) {
      selecionar(id);
      cbSelecao?.(id);
    },
    aoTerminar() {
      imersiva = null;
      renderer.xr.enabled = false;
      if (antesDoImersivo) {
        camera.position.copy(antesDoImersivo.posicao);
        camera.quaternion.copy(antesDoImersivo.quaternion);
        orbita.target.copy(antesDoImersivo.alvo);
        antesDoImersivo = null;
      }
      redimensionar();
      ultimoAviso = 0;
    },
  });
  async function entrarImersivo(tipo: TipoXr, sobreposicao?: HTMLElement): Promise<boolean> {
    if (imersiva) return true;
    // nada de espera antes do pedido: o navegador só abre a sessão dentro do gesto (clique) da pessoa
    if (modo !== 'orbita') definirModo('orbita');
    voo = null;
    poseSeguida = null;
    const guardada = { posicao: camera.position.clone(), alvo: orbita.target.clone(), quaternion: camera.quaternion.clone() };
    try {
      imersiva = tipo === 'vr' ? await iniciarVr(contextoXr()) : await iniciarAr(contextoXr(), sobreposicao!);
      antesDoImersivo = guardada;
      return true;
    } catch {
      renderer.xr.enabled = false;
      return false; // sem aparelho, recusado pela pessoa ou pelo navegador
    }
  }

  // -------------------------------------------------------------- vista da janela e estudo solar
  /** Prédios do entorno como caixas (fazem sombra nas fachadas no estudo solar). */
  let obstaculos: Caixa[] = [];
  let estudo: Map<string, EstudoSolar> | null = null;
  let emVista = false;
  const NORMAL_DO_LADO = { '+z': { x: 0, z: 1 }, '-z': { x: 0, z: -1 }, '+x': { x: 1, z: 0 }, '-x': { x: -1, z: 0 } } as const;

  /** Face externa da unidade: no prédio de volumes, o lado sem vizinha; no GLB, o lado que dá para fora do prédio. */
  function faceDaUnidade(p: PecaUnidade): FaceSolar | null {
    const c = p.caixa;
    const meio = { x: (c.minX + c.maxX) / 2, y: c.minY + 1.5, z: (c.minZ + c.maxZ) / 2 };
    let normal: { x: number; z: number };
    if (!solidos.length) {
      const doAndar = [...pecas.values()].filter((o) => o.unidade.andar === p.unidade.andar).map((o) => o.caixa);
      const lado = ladoExterno(c, doAndar);
      if (!lado) return null;
      normal = NORMAL_DO_LADO[lado];
    } else {
      const b = caixaDoPredio();
      const dx = meio.x - (b.minX + b.maxX) / 2;
      const dz = meio.z - (b.minZ + b.maxZ) / 2;
      if (Math.hypot(dx, dz) < 0.5) return null; // no meio do prédio: sem fachada
      normal = Math.abs(dx) > Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
    }
    const centro = {
      x: normal.x > 0 ? c.maxX : normal.x < 0 ? c.minX : meio.x,
      y: meio.y,
      z: normal.z > 0 ? c.maxZ : normal.z < 0 ? c.minZ : meio.z,
    };
    return { centro, normal };
  }
  const solNaCena = (dataISO: string, hora: number) => paraReferenciaDoProjeto(sunDirection(horaSaoPauloParaUtc(dataISO, hora), lat, lon), rotacao);

  // -------------------------------------------------------------- sol
  let clima: Clima = 'limpo';
  /** Direção PARA o sol (referencial da cena). */
  const sol = new THREE.Vector3(1, 1, 1).normalize();
  const COR_SOL_ALTO = new THREE.Color(0xfff6ea);
  const COR_SOL_BAIXO = new THREE.Color(0xffa45c);
  /**
   * Luz do sol, do céu e dos reflexos a partir da hora e do clima: o sol nasce fraco e alaranjado e fica branco no
   * alto; nublado espalha a luz (sombra quase some); à noite sobra a luz azulada do céu.
   */
  function aplicarLuz(): void {
    const elevacao = sol.y;
    const forca = THREE.MathUtils.smoothstep(elevacao, -0.02, 0.25); // 0 de noite → 1 com o sol a ~15°
    const corSol = COR_SOL_BAIXO.clone().lerp(COR_SOL_ALTO, THREE.MathUtils.smoothstep(elevacao, 0.02, 0.35));
    for (const l of csm.lights) {
      l.intensity = forca * (clima === 'limpo' ? 2.4 : 0.45);
      l.color.copy(corSol);
    }
    const noite = 1 - THREE.MathUtils.smoothstep(elevacao, -0.12, 0.05);
    ceu.intensity = THREE.MathUtils.lerp(clima === 'limpo' ? 0.4 : 0.95, 0.42, noite); // à noite: luar azulado
    ceu.color.setHex(noite > 0.5 ? 0x8ea4d8 : 0xffffff);
    // o céu físico é muito mais claro que o resto da cena: os reflexos entram fracos (só dão o brilho do vidro)
    cena.environmentIntensity = THREE.MathUtils.lerp(clima === 'limpo' ? 0.28 : 0.4, 0.1, noite);
    atmosfera.atualizar(sol, clima);
    const antes = luzNoturna;
    luzNoturna = Math.round(noite * 20) / 20;
    fachadaCidade.noite.value = luzNoturna;
    if (luzNoturna !== antes && pecas.size) pintar();
    pos?.definirBrilho(luzNoturna);
    paisagismo?.definirNoite(luzNoturna);
    (cena.background as THREE.Color).copy(atmosfera.horizonte);
    cena.fog?.color.copy(atmosfera.horizonte);
  }
  function definirSol(dataISO: string, hora: number): void {
    const mundo = sunDirection(horaSaoPauloParaUtc(dataISO, hora), lat, lon);
    const local = paraReferenciaDoProjeto(mundo, rotacao);
    csm.lightDirection.copy(local).negate();
    sol.copy(local).normalize();
    aplicarLuz();
  }
  function definirClima(novo: Clima): void {
    clima = novo;
    aplicarLuz();
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
    pessoas?.definirQuantidade(MORADORES_POR_NIVEL[n.nome]);
    cidadeCompleta?.definirNivel(n.nome);
    ajustarPos(n);
  }

  // acabamento de imagem: carregado à parte (não pesa na 1ª imagem) e só no nível alto
  let pos: PosProcessamento | null = null;
  let carregandoPos = false;
  let destruido = false;
  function ajustarPos(n: NivelQualidade): void {
    if (!n.posProcessamento) {
      pos?.destruir();
      pos = null;
      return;
    }
    if (pos || carregandoPos) return;
    carregandoPos = true;
    void import('./ambiente/pos')
      .then((m) => {
        if (destruido || !qualidade.nivel.posProcessamento) return;
        pos = m.criarPos(renderer, cena, camera);
        pos.definirBrilho(luzNoturna);
        const pai = canvas.parentElement ?? canvas;
        pos.redimensionar(Math.max(1, pai.clientWidth), Math.max(1, pai.clientHeight), renderer.getPixelRatio());
      })
      .catch(() => erros++) // sem o acabamento, a imagem continua normal
      .finally(() => (carregandoPos = false));
  }
  /** O quadro com o acabamento quando há; senão, o desenho direto. */
  const desenhar = () => (pos && !renderer.xr.isPresenting ? pos.desenhar() : renderer.render(cena, camera));

  // -------------------------------------------------------------- tamanho e laço
  const redimensionar = () => {
    if (renderer.xr.isPresenting) return; // no óculos o tamanho é do aparelho; volta a valer ao sair
    const pai = canvas.parentElement ?? canvas;
    const w = Math.max(1, pai.clientWidth);
    const h = Math.max(1, pai.clientHeight);
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    csm.updateFrustums();
    pos?.redimensionar(w, h, renderer.getPixelRatio());
  };
  const observador = new ResizeObserver(redimensionar);
  observador.observe(canvas.parentElement ?? canvas);
  redimensionar();
  // fora da tela (a pessoa rolou até o formulário) o laço não desenha: poupa a bateria do celular e a CPU
  let naTela = true;
  const vigia = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([e]) => (naTela = e?.isIntersecting ?? true));
  vigia?.observe(canvas);

  let cbSelecao: ((id: string | null) => void) | null = null;
  let cbMudanca: ((e: EstadoViewer) => void) | null = null;
  let ultimoQuadro = performance.now();
  let ultimoAviso = 0;
  const direcaoCamera = new THREE.Vector3();

  function atualizarRaioX(alvo: THREE.Vector3 | null): void {
    if (!alvo || !cidade) {
      raioX.raio.value = 0;
      return;
    }
    const c = caixaDoPredio();
    raioX.camera.value.copy(camera.position);
    raioX.alvo.value.copy(alvo);
    raioX.raio.value = Math.max(15, Math.hypot(c.maxX - c.minX, c.maxZ - c.minZ) / 2 + 6);
  }

  async function gerarGiro(opcoes: { quadros?: number; aoProgredir?: (feitos: number, total: number) => void } = {}): Promise<Giro> {
    await pronto;
    const total = opcoes.quadros ?? 72;
    const w = canvas.width;
    const h = canvas.height;
    const unidades = [...pecas.keys()];
    const c = caixaDoPredio();
    const centro = new THREE.Vector3((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
    const inicial = enquadrar(c, camera.fov, camera.aspect || 1, 30);
    const distancia = inicial.posicao.distanceTo(inicial.alvo);
    const anguloInicial = Math.atan2(camera.position.x - centro.x, camera.position.z - centro.z);
    const guardada = { posicao: camera.position.clone(), alvo: orbita.target.clone() };

    // máscara: sem antisserrilhado e sem conversão de cor (alvo linear), para cada pixel ter a cor-ID exata
    const alvoMascara = new THREE.WebGLRenderTarget(w, h);
    const preto = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
    const deMascara = new Map<THREE.Mesh, THREE.MeshBasicMaterial>();
    unidades.forEach((id, i) => {
      const [r, g, b] = corDoIndice(i);
      const m = new THREE.MeshBasicMaterial({ fog: false });
      m.color.setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
      m.clippingPlanes = (pecas.get(id)!.material.clippingPlanes ?? []).slice();
      deMascara.set(pecas.get(id)!.malha, m);
    });
    const pixels = new Uint8Array(w * h * 4);
    const tela2d = document.createElement('canvas');
    tela2d.width = w;
    tela2d.height = h;
    const ctx = tela2d.getContext('2d');
    if (!ctx) throw new Error('Sem suporte a canvas 2D');
    const imagem = ctx.createImageData(w, h);
    const blob = (alvo: HTMLCanvasElement, tipo: string, q?: number) =>
      new Promise<Blob>((ok, erro) => alvo.toBlob((b) => (b ? ok(b) : erro(new Error('Falha ao gerar a imagem'))), tipo, q));

    pausado = true;
    const comLazer = marcadores?.objeto.visible ?? false;
    if (marcadores) marcadores.objeto.visible = false; // fora das imagens e das máscaras do giro
    const comPessoas = pessoas?.objeto.visible ?? false;
    if (pessoas) pessoas.objeto.visible = false;
    const quadros: Giro['quadros'] = [];
    try {
      for (let i = 0; i < total; i++) {
        const pose = poseNoGiro(i, total, centro, distancia, 30, anguloInicial);
        camera.position.set(pose.posicao.x, pose.posicao.y, pose.posicao.z);
        camera.lookAt(centro);
        camera.updateMatrixWorld();
        atualizarRaioX(centro);
        csm.update();
        renderer.setRenderTarget(null);
        renderer.render(cena, camera);
        const cor = blob(canvas, 'image/jpeg', 0.85); // a cópia do canvas é feita já na chamada

        const materiaisOriginais = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
        const fundo = cena.background;
        const neblina = cena.fog;
        const escondidos: THREE.Object3D[] = [];
        cena.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          if (o.userData.foraDaMascara && o.visible) {
            o.visible = false;
            escondidos.push(o);
            return;
          }
          materiaisOriginais.set(o, o.material);
          o.material = deMascara.get(o) ?? preto;
        });
        if (cidade) cidade.visible = false; // o raio-x já tira a cidade da frente na imagem colorida
        cena.background = new THREE.Color(0x000000);
        cena.fog = null;
        // sem reflexos: o mapa do céu também tingiria as cores exatas da máscara
        const reflexos = cena.environment;
        cena.environment = null;
        renderer.setRenderTarget(alvoMascara);
        renderer.render(cena, camera);
        renderer.readRenderTargetPixels(alvoMascara, 0, 0, w, h, pixels);
        renderer.setRenderTarget(null);
        for (const [m, mat] of materiaisOriginais) m.material = mat;
        for (const o of escondidos) o.visible = true;
        cena.environment = reflexos;
        if (cidade) cidade.visible = true;
        cena.background = fundo;
        cena.fog = neblina;

        // WebGL lê de baixo para cima; a imagem é de cima para baixo
        for (let y = 0; y < h; y++) imagem.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        for (let k = 3; k < imagem.data.length; k += 4) imagem.data[k] = 255;
        ctx.putImageData(imagem, 0, 0);
        quadros.push({ cor: await cor, mascara: await blob(tela2d, 'image/png') });
        opcoes.aoProgredir?.(i + 1, total);
        await new Promise((r) => setTimeout(r, 0)); // deixa a tela atualizar o progresso
      }
    } finally {
      alvoMascara.dispose();
      preto.dispose();
      for (const m of deMascara.values()) m.dispose();
      camera.position.copy(guardada.posicao);
      orbita.target.copy(guardada.alvo);
      camera.lookAt(guardada.alvo);
      pausado = false;
      if (marcadores) marcadores.objeto.visible = comLazer;
      if (pessoas) pessoas.objeto.visible = comPessoas;
    }
    return { quadros, unidades, largura: w, altura: h };
  }

  let pausado = false; // enquanto gera o giro, o laço não desenha
  /** Quem espera o próximo quadro desenhado (medir a troca de acabamento de ponta a ponta). */
  const esperandoQuadro: Array<(agora: number) => void> = [];
  const proximoQuadro = () => new Promise<number>((ok) => esperandoQuadro.push(ok));
  /** Estado da câmera para a tela (modo, rumo, posição), no máximo 4 vezes por segundo. */
  const avisar = (agora: number) => {
    if (!cbMudanca || agora - ultimoAviso <= 250) return;
    ultimoAviso = agora;
    camera.getWorldDirection(direcaoCamera);
    cbMudanca({
      fps: Math.round(qualidade.fps),
      nivel: qualidade.nivel.nome,
      rumo: Math.round(rumoDaCamera(direcaoCamera, rotacao)),
      modo,
      posicao: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      acabamento: pos !== null,
      imersivo: imersiva?.tipo ?? null,
      moradores: pessoas?.objeto.visible ? (pessoas.objeto.children[0] as THREE.InstancedMesh).count : 0,
      som: som.ligado(),
      decorado: decorado?.moveis ?? 0,
      outros: outros.size,
      explosao: Math.round(explosao.atual * 100) / 100,
      etiquetas: rotulos.size,
      rota: rotaDesenhada?.userData.pontos ?? 0,
      corretora: !corretora || !corretora.objeto.visible ? 'fora' : corretoraFalando ? 'falando' : 'parada',
      terceiraPessoa,
      boneco: presetId,
      noAr,
      correndo,
      direcao: { x: direcaoCamera.x / (Math.hypot(direcaoCamera.x, direcaoCamera.z) || 1), z: direcaoCamera.z / (Math.hypot(direcaoCamera.x, direcaoCamera.z) || 1) },
    });
  };
  renderer.setAnimationLoop((agora: number, frame?: XRFrame) => {
    if (imersiva) {
      // óculos ou câmera: a pose vem do aparelho (sem órbita, sem acabamento de imagem, no ritmo do aparelho)
      imersiva.quadro(frame);
      if (imersiva.tipo === 'vr') {
        atmosfera.quadro(camera, agora / 1000);
        pessoas?.quadro(agora / 1000);
        som.quadro(camera, agora / 1000, luzNoturna < 0.5);
        csm.update();
      }
      renderer.render(imersiva.cena, camera);
      avisar(agora);
      return;
    }
    if (pausado) return;
    if (!naTela && !voo && !esperandoQuadro.length) {
      ultimoQuadro = agora; // ao voltar, o intervalo parado não conta como quadro lento
      avisar(agora); // a tela continua sabendo o modo (ex.: trocou para 1ª pessoa com o 3D fora da tela)
      return;
    }
    const dtMs = agora - ultimoQuadro;
    ultimoQuadro = agora;
    if (dtMs > 0 && dtMs <= 250) {
      somaQuadrosMs += dtMs;
      quadros++;
    }
    const troca = qualidade.registrar(dtMs);
    if (troca) aplicarQualidade(troca);

    if (voo) {
      const t = (agora - voo.inicio) / duracaoVoo;
      const pose = voo.trajeto(t);
      camera.position.copy(pose.posicao);
      orbita.target.copy(pose.alvo);
      camera.lookAt(pose.alvo);
      if (t >= 1) {
        voo = null;
        orbita.enabled = modo === 'orbita';
      }
    } else if (poseSeguida && modo === 'orbita') {
      // tour guiado: chega suave na câmera da consultora (sem tranco a cada pacote)
      const k = 1 - Math.exp(-dtMs / 180);
      camera.position.lerp(poseSeguida.posicao, k);
      orbita.target.lerp(poseSeguida.alvo, k);
      camera.lookAt(orbita.target);
    } else if (modo === 'orbita') {
      orbita.update();
    } else {
      // quadro longo (aparelho lento, desenho por software): anda o tempo real em passos de até 0,1 s, para não
      // atravessar parede nem ficar parado (antes o quadro valia no máximo 0,1 s, e a pessoa quase não andava)
      const total = Math.min(dtMs, 1000) / 1000;
      const passos = Math.max(1, Math.ceil(total / 0.1));
      const dt = total / passos;
      const controle = navigator.getGamepads?.().find((g) => g?.connected);
      for (let passo = 0; passo < passos; passo++) {
        let entrada = entradaAtual();
        // controle de videogame: alavanca esquerda anda, direita olha
        if (controle) {
          const c = entradaDoControle(controle.axes);
          entrada = { frente: entrada.frente + c.andar.frente, lado: entrada.lado + c.andar.lado };
          pessoa.yaw -= c.girar * dt * 2.2;
          pessoa.pitch = THREE.MathUtils.clamp(pessoa.pitch - c.inclinar * dt * 1.6, -1.2, 1.2);
        }
        // tocar no chão para ir: só enquanto ninguém usa teclado, joystick ou controle
        if (entrada.frente !== 0 || entrada.lado !== 0) alvoCaminhada = null;
        else if (alvoCaminhada) {
          const r = rumoAoAlvo(pessoa, alvoCaminhada, dt);
          pessoa.yaw = r.yaw;
          entrada = r.entrada;
          if (r.chegou) alvoCaminhada = null;
        }
        if (pedidoPulo && !noAr) {
          noAr = true;
          velocidadeVertical = PULO_M_S;
        }
        pedidoPulo = false;
        if (entrada.frente === 0 && entrada.lado === 0 && passo > 0 && !noAr) break; // parado: nada mais a simular
        const antes = { x: pessoa.x, z: pessoa.z };
        Object.assign(pessoa, passoPrimeiraPessoa(pessoa, entrada, dt, { velocidade: correndo ? CORRIDA_M_S : VELOCIDADE_M_S, bloqueado: (de, para) => bloqueado(de, para) || bloqueadoCidade(de, para) || bloqueadoDecorado(de, para) }));
        andadoQuadro += Math.hypot(pessoa.x - antes.x, pessoa.z - antes.z);
        // preso (parede no caminho do toque): desiste em 0,6 s
        if (alvoCaminhada && entrada.frente > 0) {
          paradoMs = pessoa.x === antes.x && pessoa.z === antes.z ? paradoMs + dt * 1000 : 0;
          if (paradoMs > 600) alvoCaminhada = null;
        }
        // os pés seguem o piso: sobe escada e rampa, desce suave; no pulo, a gravidade manda
        const piso = seguirPiso(pessoa.y, pessoa.x, pessoa.z, alturaDoPiso);
        if (noAr) {
          pessoa.y += velocidadeVertical * dt;
          velocidadeVertical -= GRAVIDADE * dt;
          if (velocidadeVertical < 0 && pessoa.y <= piso) {
            pessoa.y = piso;
            noAr = false;
            velocidadeVertical = 0;
          }
        } else pessoa.y = piso > pessoa.y ? piso : pessoa.y + (piso - pessoa.y) * Math.min(1, dt * 10);
      }
      tempoQuadro += total;
      posicionarPessoa();
    }

    atualizarRaioX(modo === 'orbita' && !emVista ? orbita.target : null);
    // pessoas da visita em grupo: andam suave até a última posição recebida (chega a cada ~0,5 s)
    for (const o of outros.values()) {
      const k = 1 - Math.exp(-dtMs / 160);
      const antes = { ...o.atual };
      o.atual.x += (o.alvo.x - o.atual.x) * k;
      o.atual.y += (o.alvo.y - o.atual.y) * k;
      o.atual.z += (o.alvo.z - o.atual.z) * k;
      o.atual.yaw += Math.atan2(Math.sin(o.alvo.yaw - o.atual.yaw), Math.cos(o.alvo.yaw - o.atual.yaw)) * k;
      const d = Math.hypot(o.atual.x - antes.x, o.atual.z - antes.z);
      o.b.atualizar(o.atual, { distancia: d, velocidade: dtMs > 0 ? (d * 1000) / dtMs : 0, noAr: false, acenando: 0 }, agora / 1000, menosMovimento);
    }
    if (explosao.atual !== explosao.alvo) {
      const passo = menosMovimento ? 1 : Math.min(1, dtMs / 350);
      explosao.atual += (explosao.alvo - explosao.atual) * passo;
      if (Math.abs(explosao.alvo - explosao.atual) < 0.005) explosao.atual = explosao.alvo;
      aplicarExplosao(explosao.atual);
    }
    if (corretora?.objeto.visible) {
      const yaw = Math.atan2(-(camera.position.x - corretoraPos.x), -(camera.position.z - corretoraPos.z));
      corretora.atualizar({ x: corretoraPos.x, y: 0, z: corretoraPos.z, yaw }, { distancia: 0, velocidade: 0, noAr: false, acenando: corretoraFalando ? 1 : 0 }, agora / 1000, menosMovimento);
    }
    atmosfera.quadro(camera, config.qualidadeFixa || menosMovimento ? 0 : agora / 1000); // qualidade fixa = cena determinística (nuvens paradas)
    VENTO.tempo.value = config.qualidadeFixa || menosMovimento ? 0 : agora / 1000; // copas com vento (paradas na cena de teste)
    pessoas?.quadro(agora / 1000);
    som.quadro(camera, agora / 1000, luzNoturna < 0.5);
    csm.update();
    desenhar();
    if (esperandoQuadro.length) for (const ok of esperandoQuadro.splice(0)) ok(performance.now());

    avisar(agora);
  });

  /**
   * Compila os materiais da cena antes de eles aparecerem (Plano 12a, item 14): sem isso, o 1º giro que mostra a
   * cidade ou o paisagismo engasga compilando shader. Em paralelo quando a placa permite; nunca atrasa a 1ª imagem.
   */
  function aquecerMateriais(): void {
    try {
      void renderer.compileAsync(cena, camera).catch(() => undefined);
    } catch {
      // sem compilação antecipada: compila no 1º quadro, como antes
    }
  }

  const pronto = (config.modeloUrl ? montarModelo(config.modeloUrl) : Promise.resolve(montarVolumes())).then(() => {
    pintar();
    enquadrarPredio();
    montarPaisagismo();
    ajustarPos(qualidade.nivel);
    aquecerMateriais();
  });
  pronto.then(
    () => (cargaMs = Math.round(performance.now() - criadoEm)),
    () => erros++,
  );
  definirSol(new Date().toISOString().slice(0, 10), 10);

  return {
    pronto,
    definirDestaque(passam, favs) {
      destaque = passam;
      favoritos = favs;
      pintar();
      rotularUnidades(passam);
    },
    definirStatus(id, status) {
      const p = pecas.get(id);
      if (!p) return false;
      p.unidade = { ...p.unidade, status };
      pintar();
      return true;
    },
    cortarNoAndar(andar) {
      const y = andar === null ? null : alturaDoCorte([...pecas.values()].map((p) => ({ andar: p.unidade.andar, caixa: p.caixa })), andar);
      corteY = y;
      const planos = y === null ? [] : [planoDeCorte(y + 0.01)];
      planosCorte = planos;
      for (const m of materiaisPredio) {
        m.clippingPlanes = planos;
        m.needsUpdate = true;
      }
      return andar === null || y !== null;
    },
    desenharRota(pontos) {
      apagarRota();
      if (!pontos || pontos.length < 2 || !centroEntorno) return false;
      const centro = centroEntorno;
      const xz = pontos.map(([lon, lat]) => paraModelo(lonLatToLocal({ lon, lat }, centro), rotacao));
      const altura = cidadeCompleta?.terreno.altura ?? (() => 0);
      const geo = fita({ pontos: xz, largura: 2.4 }, altura, 0.35);
      if (!geo) return false;
      const grupo = new THREE.Group();
      grupo.name = 'rota-a-pe';
      // ciano por cima de tudo no chão (sem sombra, sem esconder atrás do meio-fio)
      const linha = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.92, depthWrite: false }));
      linha.renderOrder = 6;
      const fim = xz.at(-1)!;
      const alvo = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.2, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      alvo.position.set(fim.x, altura(fim.x, fim.z) + 0.4, fim.z);
      alvo.renderOrder = 6;
      grupo.add(linha, alvo);
      grupo.userData.pontos = pontos.length;
      cena.add(grupo);
      rotaDesenhada = grupo;
      // enquadra o caminho inteiro (do prédio ao destino), de cima
      if (modo !== 'orbita') definirModo('orbita');
      const caixa = {
        minX: Math.min(...xz.map((q) => q.x)),
        maxX: Math.max(...xz.map((q) => q.x)),
        minY: 0,
        maxY: 20,
        minZ: Math.min(...xz.map((q) => q.z)),
        maxZ: Math.max(...xz.map((q) => q.z)),
      };
      orbita.enabled = false;
      voo = { trajeto: planejarVoo({ posicao: camera.position.clone(), alvo: orbita.target.clone() }, enquadrar(caixa, camera.fov, camera.aspect || 1, 55, 1.3)), inicio: performance.now() };
      ultimoAviso = 0;
      return true;
    },
    separarAndares(ligado) {
      if (ligado && modo !== 'orbita') definirModo('orbita');
      explosao.alvo = ligado ? 1 : 0;
    },
    andaresComCorte() {
      return [...new Set([...pecas.values()].map((p) => p.unidade.andar))].sort((a, b) => a - b);
    },
    voarPara(id) {
      const p = pecas.get(id);
      if (!p) return false;
      sairDaVista();
      if (modo !== 'orbita') definirModo('orbita');
      orbita.enabled = false;
      marcadores?.destacar(null);
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
    definirClima,
    estudoSolar() {
      if (estudo) return estudo;
      const calculado = new Map<string, EstudoSolar>();
      for (const [id, p] of pecas) {
        const face = faceDaUnidade(p);
        if (face) calculado.set(id, estudoSolar(face, obstaculos, solNaCena, lat < 0));
      }
      estudo = calculado;
      return calculado;
    },
    mapaDoLote() {
      const predio = caixaDoPredio();
      const cx = (predio.minX + predio.maxX) / 2;
      const cz = (predio.minZ + predio.maxZ) / 2;
      const vizinhos = obstaculos.filter((o) => Math.hypot((o.minX + o.maxX) / 2 - cx, (o.minZ + o.maxZ) / 2 - cz) < 150);
      return { predio, vizinhos, lazer: pontosLazer.map((p) => ({ id: p.id, x: p.x, z: p.z })) };
    },
    definirLazer(pontos) {
      if (marcadores) {
        cena.remove(marcadores.objeto);
        marcadores.destruir();
        marcadores = null;
      }
      pontosLazer = [...pontos];
      if (!pontos.length) return;
      marcadores = criarMarcadoresLazer(pontos);
      cena.add(marcadores.objeto);
      som.definirFontes({ arvores: arvoresDoLote, agua: aguaDoLazer() }); // a água da piscina entra no som
    },
    async definirSom(ligado) {
      if (!ligado) {
        som.desligar();
        return false;
      }
      return som.ligar();
    },
    voarParaLazer(id) {
      const p = pontosLazer.find((x) => x.id === id);
      if (!p) return false;
      sairDaVista();
      if (modo !== 'orbita') definirModo('orbita');
      orbita.enabled = false;
      const c = caixaDoPredio();
      voo = { trajeto: planejarVoo({ posicao: camera.position.clone(), alvo: orbita.target.clone() }, poseParaLazer(p, { x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2 })), inicio: performance.now() };
      marcadores?.destacar(id);
      return true;
    },
    aoSelecionarLazer(cb) {
      cbLazer = cb;
    },
    definirTerceiraPessoa(ligada) {
      terceiraPessoa = ligada;
      if (modo === 'primeira-pessoa') posicionarPessoa();
      ultimoAviso = 0;
      avisar(performance.now());
    },
    definirBoneco(id) {
      presetId = presetBoneco(id).id;
      boneco?.trocar(presetBoneco(presetId));
      ultimoAviso = 0;
    },
    pular() {
      if (modo !== 'primeira-pessoa' || noAr) return false;
      pedidoPulo = true;
      return true;
    },
    definirCorrida(ligada) {
      correndo = ligada;
      ultimoAviso = 0;
    },
    acenar() {
      acenarAte = performance.now() + 2000;
    },
    definirOutros(lista) {
      const ids = new Set(lista.map((p) => p.id));
      for (const [id, o] of outros) {
        if (ids.has(id)) continue;
        cena.remove(o.b.objeto);
        o.b.destruir();
        outros.delete(id);
      }
      for (const p of lista) {
        const alvo = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
        const o = outros.get(p.id);
        if (!o) {
          const b = criarBoneco(presetBoneco(p.boneco), (m) => prepararMaterial(m));
          cena.add(b.objeto);
          outros.set(p.id, { b, alvo, atual: { ...alvo } });
        } else {
          o.alvo = alvo;
          if (o.b.preset.id !== presetBoneco(p.boneco).id) o.b.trocar(presetBoneco(p.boneco));
        }
      }
      ultimoAviso = 0;
    },
    minhaPosicao() {
      return modo === 'primeira-pessoa' ? { x: pessoa.x, y: pessoa.y, z: pessoa.z, yaw: pessoa.yaw, boneco: presetId } : null;
    },
    mostrarCorretora(c) {
      if (!c) {
        if (corretora) corretora.objeto.visible = false;
        corretoraFalando = false;
        ultimoAviso = 0;
        return;
      }
      if (!corretora) {
        corretora = criarBoneco(CORRETORA, (m) => prepararMaterial(m));
        cena.add(corretora.objeto);
      }
      corretora.objeto.visible = true;
      corretoraFalando = c.falando;
      // na calçada da frente (+z, a entrada), alinhada com a unidade de que se fala
      const lote = caixaDoPredio();
      const u = c.unidadeId ? pecas.get(c.unidadeId)?.caixa : null;
      const x = u ? THREE.MathUtils.clamp((u.minX + u.maxX) / 2, lote.minX + 1, lote.maxX - 1) : (lote.minX + lote.maxX) / 2 + 1.5;
      corretoraPos = { x, z: lote.maxZ + 3.5 };
      ultimoAviso = 0;
    },
    definirFotos(fotos) {
      fotosNoLugar = [...fotos];
      return montarQuadros();
    },
    async mostrarFoto(id, url) {
      imagensDosQuadros.set(id, url);
      return quadrosFoto ? quadrosFoto.definirImagem(id, url) : false;
    },
    aoSelecionarFoto(cb) {
      cbFoto = cb;
    },
    poseCamera() {
      const alvo = modo === 'orbita' ? orbita.target.clone() : camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(5).add(camera.position);
      const r = (v: THREE.Vector3): [number, number, number] => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
      return { posicao: r(camera.position), alvo: r(alvo) };
    },
    seguirPose(pose) {
      if (!pose) {
        poseSeguida = null;
        orbita.enabled = modo === 'orbita';
        return;
      }
      if (modo !== 'orbita') definirModo('orbita');
      sairDaVista();
      voo = null;
      orbita.autoRotate = false;
      orbita.enabled = false;
      poseSeguida = { posicao: new THREE.Vector3(...pose.posicao), alvo: new THREE.Vector3(...pose.alvo) };
    },
    entrarNaUnidade(id) {
      const p = pecas.get(id);
      if (!p) return false;
      sairDaVista();
      definirModo('primeira-pessoa');
      const c = p.caixa;
      const x = (c.minX + c.maxX) / 2;
      const z = (c.minZ + c.maxZ) / 2;
      const face = faceDaUnidade(p);
      // de frente para a janela (sem face externa, para o norte); um passo atrás do meio, para ver o cômodo
      const yaw = face ? yawPara(face.normal.x, face.normal.z) : 0;
      const recuo = face ? 1.2 : 0;
      const y = solidos.length ? (alturaDoPiso(x, z, c.maxY - 0.2) ?? c.minY) : c.minY;
      Object.assign(pessoa, { x: x - (face?.normal.x ?? 0) * recuo, z: z - (face?.normal.z ?? 0) * recuo, y, yaw, pitch: -0.2 });
      tirarDecorado();
      if (!config.modeloUrl) {
        // prédio desenhado: a unidade vira apartamento decorado (sala, cozinha e quartos da tipologia)
        const plano = planejarDecorado(c, p.unidade.quartos, face ? { x: face.normal.x, z: face.normal.z } : null, config.estiloDecorado ?? 'moderno');
        decorado = montarDecorado(plano, (m) => prepararMaterial(m));
        cena.add(decorado.objeto);
        bloqueadoDecorado = bloqueioPorCaixas(plano.paredes, 0.25, ALTURA_OLHOS_M);
        // atrás do sofá, de frente para a janela: a sala, o jantar e a cozinha na frente
        Object.assign(pessoa, plano.entrada);
      }
      posicionarPessoa();
      interior = id;
      selecionada = id;
      pintar();
      ultimoAviso = 0;
      avisar(performance.now()); // a tela já recebe a posição dentro da unidade
      return true;
    },
    vistaDaUnidade(id) {
      const p = pecas.get(id);
      const face = p ? faceDaUnidade(p) : null;
      if (!p || !face) return false;
      if (modo !== 'orbita') definirModo('orbita');
      voo = null;
      orbita.autoRotate = false;
      // na varanda, a 1 m do vidro, na altura dos olhos; arrastar gira a cabeça em volta de um ponto logo à frente
      const olho = new THREE.Vector3(face.centro.x + face.normal.x, p.caixa.minY + 1.45, face.centro.z + face.normal.z);
      camera.position.copy(olho);
      orbita.target.set(olho.x + face.normal.x * 0.5, olho.y - 0.05, olho.z + face.normal.z * 0.5);
      camera.fov = 65; // lente mais aberta: o que a pessoa vê da janela
      camera.updateProjectionMatrix();
      orbita.enableZoom = false;
      orbita.enablePan = false;
      orbita.minDistance = orbita.maxDistance = 0.5;
      orbita.enabled = true;
      emVista = true;
      selecionar(id);
      return true;
    },
    apresentacao(ligada) {
      if (ligada && modo !== 'orbita') definirModo('orbita');
      orbita.autoRotate = ligada;
      orbita.autoRotateSpeed = menosMovimento ? 0.15 : 0.5; // uma volta a cada ~2 min (~7 min com menos movimento): dá para ver o prédio sem enjoar
    },
    visaoGeral() {
      orbita.autoRotate = false;
      marcadores?.destacar(null);
      sairDaVista();
      if (modo !== 'orbita') definirModo('orbita');
      voo = null;
      selecionar(null);
      enquadrarPredio();
    },
    async definirEntorno(entorno) {
      await pronto;
      apagarRota();
      centroEntorno = entorno ? { lon: entorno.centro.lon, lat: entorno.centro.lat } : null;
      // montar a cidade e compilar os materiais dela travam alguns quadros: não é o aparelho, não baixa a qualidade
      qualidade.ignorarCarga(3_000);
      if (cidade) {
        cena.remove(cidade);
        cidade.geometry.dispose();
        cidade = null;
      }
      if (cidadeCompleta) {
        cena.remove(cidadeCompleta.objeto);
        for (const m of cidadeCompleta.materiais) materiais.delete(m);
        for (const p of cidadeCompleta.pisos) pisosExtras.splice(pisosExtras.indexOf(p), 1);
        cidadeCompleta.destruir();
        cidadeCompleta = null;
      }
      chao.position.y = 0;
      bloqueadoCidade = () => false;
      atribuicaoEntorno = null;
      obstaculos = [];
      estudo = null;
      if (!entorno) return 0;
      const lote = caixaDoPredio();
      const predios = entornoParaLocal(entorno.predios, entorno.centro, rotacao, lote);
      // prédios no chão de verdade: a base de cada um é a altura do terreno no meio dele
      const terrenoDe = terrenoDoRelevo(entorno.relevo, entorno.centro, rotacao, lote);
      for (const b of predios) {
        const cx = b.footprint.reduce((s, q) => s + q.x, 0) / b.footprint.length;
        const cz = b.footprint.reduce((s, q) => s + q.z, 0) / b.footprint.length;
        const base = terrenoDe.altura(cx, cz);
        if (Math.abs(base) > 0.05) b.base = base;
      }
      obstaculos = predios.map((b) => ({
        minX: Math.min(...b.footprint.map((q) => q.x)),
        maxX: Math.max(...b.footprint.map((q) => q.x)),
        minY: b.base ?? 0,
        maxY: (b.base ?? 0) + b.height,
        minZ: Math.min(...b.footprint.map((q) => q.z)),
        maxZ: Math.max(...b.footprint.map((q) => q.z)),
      }));
      montarPaisagismo(); // sem árvores dentro dos prédios vizinhos
      if (entorno.vias?.length || entorno.areas?.length || entorno.relevo) {
        cidadeCompleta = criarCidade(entorno, rotacao, lote, obstaculos, (m) => prepararMaterial(m));
        cidadeCompleta.definirNivel(qualidade.nivel.nome);
        cena.add(cidadeCompleta.objeto);
        pisosExtras.push(...cidadeCompleta.pisos);
        // além do relevo, o chão do horizonte fica embaixo de tudo (sem cobrir os vales)
        if (cidadeCompleta.terreno.meioLado > 0) chao.position.y = cidadeCompleta.terreno.horizonte;
      }
      if (predios.length === 0) {
        atribuicaoEntorno = entorno.atribuicao;
        montarQuadros();
        return 0;
      }
      montarQuadros(); // os postes das fotos no chão de verdade
      cidade = buildCityMesh(predios, materialCidade);
      cidade.castShadow = true;
      cidade.receiveShadow = true;
      cena.add(cidade);
      bloqueadoCidade = bloqueioPorRaio([cidade]);
      atribuicaoEntorno = entorno.atribuicao;
      qualidade.ignorarCarga(3_000); // o 1º quadro com a cidade compila o material dela
      aquecerMateriais(); // e compila já, em paralelo, para o 1º giro não engasgar
      return predios.length;
    },
    gerarGiro,
    metricas() {
      return { cargaMs, fpsMedio: somaQuadrosMs > 0 ? Math.round((quadros * 10_000) / somaQuadrosMs) / 10 : null, nivel: qualidade.nivel.nome, erros };
    },
    registrarErro() {
      erros++;
    },
    superficies() {
      return configurador?.superficies() ?? [];
    },
    async definirAcabamento(chave, acabamento) {
      await pronto;
      const inicio = performance.now();
      if (!configurador?.definirAcabamento(chave, acabamento)) return null;
      const trabalhoMs = Math.round((performance.now() - inicio) * 10) / 10;
      return { trabalhoMs, ateQuadroMs: Math.round((await proximoQuadro()) - inicio) };
    },
    async prepararAcabamentos(acabamentos) {
      await pronto;
      if (!configurador) return;
      const texturas = configurador.preparar([]);
      for (const a of acabamentos) {
        texturas.push(...configurador.preparar([a]));
        for (const t of texturas.splice(0)) renderer.initTexture(t);
        await proximoQuadro();
      }
    },
    async colocarMovel(id, fonte, pose) {
      await pronto;
      if (!configurador) throw new Error('Configurador desligado (precisa de modelo GLB e configurador: true)');
      const p = ajustarPose(pose);
      await configurador.colocarMovel(id, fonte, p);
      return p;
    },
    moverMovel(id, pose) {
      const p = ajustarPose(pose);
      return configurador?.moverMovel(id, p) ? p : null;
    },
    removerMovel(id) {
      return configurador?.removerMovel(id) ?? false;
    },
    aoClicarPiso(cb) {
      cbPiso = cb;
    },
    aoSelecionarMovel(cb) {
      cbMovel = cb;
    },
    pisoAbaixo(x, z, deY = ALTURA_OLHOS_M) {
      const r = new THREE.Raycaster(new THREE.Vector3(x, deY, z), new THREE.Vector3(0, -1, 0));
      for (const h of r.intersectObjects([...solidos, chao, ...pisosExtras], false)) {
        if (!h.face) continue;
        if (normalMundo.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.7) return { x: h.point.x, y: h.point.y, z: h.point.z };
      }
      return null;
    },
    capturar(dados) {
      // desenha e copia na mesma tarefa: depois o navegador pode limpar o buffer do WebGL
      desenhar();
      return comMarca(dados);
    },
    async fotoRealista(dados, opcoes = {}) {
      if (pausado || imersiva) throw new Error('ocupado');
      const { renderizarFotorrealista } = await import('./captura/fotorrealista');
      const noite = luzNoturna;
      const luzSol = csm.lights[0];
      const luz: LuzDaFoto = {
        direcao: csm.lightDirection.clone().normalize(),
        cor: luzSol?.color.clone() ?? new THREE.Color(0xffffff),
        intensidade: (luzSol?.intensity ?? 0) * 1.15,
        horizonte: atmosfera.horizonte.clone(),
        zenite: atmosfera.horizonte.clone().lerp(new THREE.Color(noite > 0.5 ? 0x050a1a : 0x2f6fc4), 0.6),
        ceu: THREE.MathUtils.lerp(clima === 'limpo' ? 0.9 : 1.3, 0.12, noite),
      };
      const objetos = [raizPredio, paisagismo?.objeto, cidade, cidadeCompleta?.objeto, chao, pessoas?.objeto.visible ? pessoas.objeto : null].filter((o): o is THREE.Object3D => o != null);
      pausado = true; // o 3D normal para: o canvas mostra a foto "revelando"
      let png: Promise<Blob> | null = null;
      try {
        await renderizarFotorrealista(renderer, objetos, camera, luz, {
          amostras: Math.max(1, Math.min(2000, Math.round(opcoes.amostras ?? 64))),
          aoProgredir: opcoes.aoProgredir,
          sinal: opcoes.sinal,
          aoTerminar: () => (png = comMarca(dados)), // na mesma tarefa da última amostra: o canvas ainda tem a foto
        });
        if (!png) throw new Error('foto sem imagem');
        return await png;
      } finally {
        pausado = false;
        ultimoQuadro = performance.now(); // o tempo parado não conta como quadro lento
      }
    },
    aoSelecionar(cb) {
      cbSelecao = cb;
    },
    aoMudar(cb) {
      cbMudanca = cb;
    },
    entrarEmVr: () => entrarImersivo('vr'),
    entrarEmAr: (sobreposicao) => entrarImersivo('ar', sobreposicao),
    async sairDoImersivo() {
      await imersiva?.encerrar();
    },
    async arquivoUsdz() {
      return exportarUsdz(montarMaquete([raizPredio, paisagismo?.objeto].filter((o): o is THREE.Object3D => o != null)));
    },
    destruir() {
      boneco?.destruir();
      destruido = true;
      void imersiva?.encerrar();
      pos?.destruir();
      renderer.setAnimationLoop(null);
      observador.disconnect();
      vigia?.disconnect();
      canvas.removeEventListener('pointerdown', aoApertar);
      canvas.removeEventListener('pointermove', aoMover);
      canvas.removeEventListener('pointerup', aoSoltar);
      window.removeEventListener('keydown', aoTeclar);
      window.removeEventListener('keyup', aoSoltarTecla);
      window.removeEventListener('blur', aoPerderFoco);
      orbita.dispose();
      configurador?.destruir();
      for (const ok of esperandoQuadro.splice(0)) ok(performance.now());
      csm.dispose();
      atmosfera.destruir();
      paisagismo?.destruir();
      marcadores?.destruir();
      pessoas?.destruir();
      som.destruir();
      cena.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of materiais) m.dispose();
      renderer.dispose();
    },
  };
}
