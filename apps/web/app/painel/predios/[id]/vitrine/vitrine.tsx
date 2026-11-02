'use client';
import { useEffect, useMemo, useRef, useState, type PointerEvent as EventoPonteiro } from 'react';
import { BONECOS, criarViewer, filtrar, suporteImersivo, temWebGpu, type SuporteImersivo, type Caixa, type Clima, type EstudoSolar, type PeriodoDeSol, type Giro, filtroVazio, pontoCardeal, vetorJoystick, type EstadoViewer, type Filtro, type UnidadeViewer, type Viewer } from '@imersa/viewer';
import type { ItemLazer, StatusUnidade } from '@/lib/tipos';
import { Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { alternarFavorito, lerFavoritos, salvarFavoritos } from '@/lib/favoritos';
import { brl, COR_STATUS, ROTULO_STATUS, STATUS_UNIDADE } from '@/lib/tipos';
import { DECODIFICADORES } from '@/lib/decodificadores';
import { giroDoZip } from '@/lib/giro-zip';
import type { ResultadoEntorno } from './actions';
import { InteriorSplat } from './interior';
import { Giro360 } from './giro';
import { Assistente, type AcaoAssistente } from './assistente';
import { ComandoVitrine } from './comando';
import { VisitaEmGrupo } from './visita-grupo';
import { FalarComCorretor } from './falar-corretor';
import type { AcaoComando } from '@/lib/comandos';
import { ehPorDoSol, MISSOES, PASSEIO_M, progressoTipologias, somarCaminhada, type IdMissao } from '@/lib/missoes';
import { SimuladorFinanciamento } from './simulador';
import { CartaoLazer, PainelDoPonto, passoDoTourMs, rotuloDoPonto, type EstadoTour } from './lazer';
import type { NovoLazer } from './actions';

const ROTULO_NIVEL = { alto: 'alta', medio: 'média', baixo: 'baixa' } as const;
const ROTULO_SOL: Record<PeriodoDeSol, string> = { manha: 'Sol da manhã', tarde: 'Sol da tarde', 'dia-todo': 'Sol o dia todo', 'pouco-sol': 'Pouco sol direto' };
const horas = (h: number) => `${h.toLocaleString('pt-BR')} h`;
const MAX_COMPARAR = 3;
/** Amostras do path tracing na foto: ~5 a 15 s numa placa de vídeo comum. */
const AMOSTRAS_FOTO = 64;

/** Texto falado da unidade (narração pela voz do próprio navegador, em português). */
function textoDaUnidade(u: UnidadeViewer, andar: string, sol: EstudoSolar | undefined): string {
  const partes = [`Unidade ${u.codigo}, ${andar}`];
  if (u.quartos !== null) partes.push(`${u.quartos} ${u.quartos === 1 ? 'quarto' : 'quartos'}`);
  if (u.areaM2 !== null) partes.push(`${u.areaM2.toLocaleString('pt-BR')} metros quadrados`);
  if (sol) partes.push(`${ROTULO_SOL[sol.periodo].toLowerCase()}, com ${sol.inverno.toLocaleString('pt-BR')} horas de sol direto no inverno`);
  if (u.status === 'disponivel' && u.preco !== null) partes.push(`por ${brl(u.preco)}`);
  return `${partes.join(', ')}.`;
}

function narrar(texto: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = 'pt-BR';
  const voz = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('pt-br')) ?? window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('pt'));
  if (voz) fala.voice = voz;
  fala.rate = 1.02;
  window.speechSynthesis.speak(fala);
  return true;
}
const hoje = () => new Date().toISOString().slice(0, 10);
const horaLegivel = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const filtroAtivo = (f: Filtro) => f.quartos.length > 0 || f.areaMin !== null || f.precoMax !== null || f.status.length > 0 || f.somenteFavoritos;
const numeroOuNulo = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
function alternar<T>(lista: T[], x: T): T[] {
  return lista.includes(x) ? lista.filter((y) => y !== x) : [...lista, x];
}

/** O que o visitante fez, para os números de vendas (portal público). */
export type EventoVitrine = { tipo: 'unidade' | 'favorito'; unidadeId: string } | { tipo: 'interior' } | { tipo: 'tour_lazer' } | { tipo: 'missao'; missao: IdMissao };

type EstadoEntorno = { tipo: 'carregando' } | { tipo: 'pronto'; predios: number; atribuicao: string } | { tipo: 'sem_localizacao' } | { tipo: 'indisponivel' };

const SEM_FOTOS: NonNullable<Parameters<typeof Vitrine>[0]['fotos']> = [];

export function Vitrine({
  predioId,
  projetoId,
  predioNome,
  empresa,
  chaveModelo,
  modeloUrl,
  unidades,
  andares,
  rotacaoGraus,
  estiloDecorado,
  fotos = SEM_FOTOS,
  inicio,
  salaUrl = null,
  corretor = null,
  lat,
  lon,
  interiores,
  qualidadeFixa = null,
  carregarEntorno,
  linkDoArquivo,
  telemetria: comTelemetria = true,
  aoEvento,
  aoVivo,
  giroRenderizado = null,
  assistenteUrl = null,
  aoPedirContato,
  estande = null,
  linksParaConduzir = [],
  lazer = [],
  gerirLazer = null,
  amostrasFoto = AMOSTRAS_FOTO,
}: {
  predioId: string;
  projetoId: string;
  predioNome: string;
  /** Nome da empresa (vai na faixa da imagem baixada). */
  empresa: string;
  /** Identidade estável do modelo (o link assinado muda a cada atualização da página). */
  chaveModelo: string;
  modeloUrl: string | null;
  unidades: UnidadeViewer[];
  andares: Array<{ numero: number; nome: string }>;
  rotacaoGraus: number;
  lat: number | null;
  lon: number | null;
  /** Estilo do apartamento decorado gerado ao entrar numa unidade do prédio desenhado. */
  estiloDecorado?: 'moderno' | 'classico' | 'jovem';
  /** Visita em grupo (só no link do cliente): endereço da sala na API. */
  salaUrl?: string | null;
  /** Link do cliente com o WhatsApp do corretor: o card da unidade ganha "Falar com o corretor" e o QR (Plano 12b). */
  corretor?: { nome: string; whatsapp: string; empreendimento: string } | null;
  /** Abrir já na vista de uma unidade e numa hora (foto pedida por texto). */
  inicio?: { unidadeId: string | null; hora: number | null };
  /** Fotos do imóvel com GPS: quadros no 3D onde foram tiradas (Plano 11c). */
  fotos?: Array<{ id: string; nome: string; lat: number; lon: number; rumo: number | null }>;
  /** Splats prontos do projeto (interiores reais). */
  interiores: Array<{ id: string; nome: string }>;
  /** Índice do nível de qualidade a manter fixo; `null` = automático. */
  qualidadeFixa?: number | null;
  /** De onde vêm os dados: no painel, pela sessão; no portal do comprador, pelo token do link. */
  carregarEntorno: () => Promise<ResultadoEntorno>;
  linkDoArquivo: (arquivoId: string) => Promise<string | null>;
  /** Desempenho do 3D (painel interno). */
  telemetria?: boolean;
  aoEvento?: (e: EventoVitrine) => void;
  /** Endereço da transmissão de status ao vivo (EventSource). Pedido de novo a cada reconexão (o bilhete do painel vence). */
  aoVivo?: () => Promise<string | null>;
  /** Giro 360° fotorrealista pronto (Blender): ZIP + a unidade de cada cor-ID. */
  giroRenderizado?: { arquivoId: string; unidades: string[] } | null;
  /** Assistente com IA (null = desligado): no painel, a rota do site; no portal, a API direto. */
  assistenteUrl?: string | null;
  /** O assistente pediu o formulário de contato (portal): abre com a unidade e o motivo. */
  aoPedirContato?: (motivo: 'contato' | 'visita', unidadeId: string | null) => void;
  /**
   * Estande de vendas (tela touch no PC do estande): `apresentando` = ninguém mexendo, a câmera gira sozinha e as
   * unidades disponíveis aparecem uma a uma; cada `reinicio` novo volta tudo ao começo (próximo visitante).
   */
  estande?: { apresentando: boolean; reinicio: number } | null;
  /** Painel: links ativos de clientes que a consultora pode conduzir ao vivo (a câmera do cliente segue a dela). */
  linksParaConduzir?: Array<{ id: string; titulo: string | null }>;
  /** Lazer do empreendimento marcado no 3D, na ordem do tour. */
  lazer?: ItemLazer[];
  /** Gestão: marcar e remover pontos do lazer (no painel). */
  /** Amostras do path tracing na foto fotorrealista. */
  amostrasFoto?: number;
  gerirLazer?: { criar: (d: NovoLazer) => Promise<{ item?: ItemLazer; erro?: string }>; remover: (id: string) => Promise<{ erro?: string }> } | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const coluna = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const inicial = useRef({ modeloUrl, unidades, rotacaoGraus, estiloDecorado, lat, lon, projetoId, predioId, qualidadeFixa, carregarEntorno, comTelemetria });
  inicial.current = { modeloUrl, unidades, rotacaoGraus, estiloDecorado, lat, lon, projetoId, predioId, qualidadeFixa, carregarEntorno, comTelemetria };
  const evento = useRef(aoEvento);
  evento.current = aoEvento;
  const fonteAoVivo = useRef(aoVivo);
  fonteAoVivo.current = aoVivo;
  // status que mudaram depois de a página abrir (venda/reserva feita agora por outra pessoa)
  const [statusAoVivo, setStatusAoVivo] = useState<Record<string, StatusUnidade>>({});
  const statusAoVivoRef = useRef(statusAoVivo);
  statusAoVivoRef.current = statusAoVivo;
  const [estadoAoVivo, setEstadoAoVivo] = useState<'desligado' | 'conectando' | 'conectado'>('desligado');
  // tour guiado ao vivo, lado do cliente: a câmera segue a da consultora até ele escolher explorar sozinho
  const [conducao, setConducao] = useState<{ ativo: boolean; posicao?: [number, number, number]; alvo?: [number, number, number]; unidade?: string | null } | null>(null);
  const [soltou, setSoltou] = useState(false);
  // lado da consultora: qual link está conduzindo
  const [conduzindo, setConduzindo] = useState<string | null>(null);
  const [linkEscolhido, setLinkEscolhido] = useState('');
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [telemetria, setTelemetria] = useState<EstadoViewer | null>(null);
  const [filtro, setFiltro] = useState<Filtro>(filtroVazio);
  const [favoritos, setFavoritos] = useState<Set<string>>(() => new Set());
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [andarCorte, setAndarCorte] = useState('');
  const [comCorte, setComCorte] = useState<number[]>([]);
  const [separados, setSeparados] = useState(false);
  // andar a pé ou entrar no apartamento junta os andares no 3D: o botão acompanha
  useEffect(() => {
    if (separados && telemetria && telemetria.modo !== 'orbita') setSeparados(false);
  }, [separados, telemetria]);
  const [dataSol, setDataSol] = useState(hoje);
  // abre no fim de tarde: sol baixo e sombras longas são a imagem mais bonita do dia (Plano 12a, item 7)
  const [horaSol, setHoraSol] = useState(16.5);
  const [clima, setClima] = useState<Clima>('limpo');
  const [entorno, setEntorno] = useState<EstadoEntorno>({ tipo: 'carregando' });
  const [interiorAberto, setInteriorAberto] = useState<{ id: string; nome: string } | null>(null);
  // VR no óculos, maquete na mesa (Android) e AR do iPhone: só o que o aparelho abre
  const [imersivo, setImersivo] = useState<SuporteImersivo>({ vr: false, ar: false, quickLook: false });
  const [usdz, setUsdz] = useState<string | null>(null);
  const [erroImersivo, setErroImersivo] = useState<string | null>(null);
  const sobreposicaoAr = useRef<HTMLDivElement>(null);
  // lazer: pontos no 3D, o tour "Conheça o lazer" e (gestão) a marcação clicando no 3D
  const [itensLazer, setItensLazer] = useState<ItemLazer[]>(lazer);
  const [pontoLazer, setPontoLazer] = useState<string | null>(null);
  const [tour, setTour] = useState<EstadoTour | null>(null);
  const [marcandoLazer, setMarcandoLazer] = useState<Omit<NovoLazer, 'x' | 'y' | 'z'> | null>(null);
  const [erroLazer, setErroLazer] = useState<string | null>(null);

  // depois da hidratação: o servidor não conhece o navegador de quem vê
  useEffect(() => setFavoritos(lerFavoritos(predioId)), [predioId]);
  useEffect(() => {
    let vivo = true;
    void suporteImersivo().then((s) => vivo && setImersivo(s));
    return () => {
      vivo = false;
    };
  }, []);
  // iPhone: o arquivo da maquete fica pronto antes do toque (o Quick Look abre direto pelo link), refeito quando a
  // situação de alguma unidade muda ao vivo
  useEffect(() => {
    if (!imersivo.quickLook || estado !== 'pronto') return;
    let vivo = true;
    let url: string | null = null;
    const t = setTimeout(() => {
      void viewer.current
        ?.arquivoUsdz()
        .then((b) => {
          if (!vivo) return;
          url = URL.createObjectURL(b);
          setUsdz(url);
        })
        .catch(() => viewer.current?.registrarErro());
    }, 800);
    return () => {
      vivo = false;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [imersivo.quickLook, estado, statusAoVivo]);
  // a sessão de AR acabou (pelo botão, pelo "voltar" do Android ou pelo navegador): a camada some
  const emImersivo = telemetria?.imersivo ?? null;
  useEffect(() => {
    if (emImersivo !== 'ar' && sobreposicaoAr.current) sobreposicaoAr.current.hidden = true;
  }, [emImersivo]);
  // fotos com GPS: quadros no 3D; a imagem chega pelo link assinado; tocar abre em tela cheia
  const [qtdFotos, setQtdFotos] = useState(0);
  const [fotoAberta, setFotoAberta] = useState<{ nome: string; url: string } | null>(null);
  const urlsFotos = useRef(new Map<string, string>());
  useEffect(() => {
    const v = viewer.current;
    if (estado !== 'pronto' || !v) return;
    setQtdFotos(v.definirFotos(fotos));
    let vivo = true;
    for (const f of fotos) {
      void linkDoArquivo(f.id).then((url) => {
        if (!vivo || !url) return;
        urlsFotos.current.set(f.id, url);
        void v.mostrarFoto(f.id, url);
      });
    }
    v.aoSelecionarFoto((id) => {
      const f = fotos.find((x) => x.id === id);
      const url = urlsFotos.current.get(id);
      if (f && url) setFotoAberta({ nome: f.nome, url });
    });
    return () => {
      vivo = false;
      v.aoSelecionarFoto(null);
    };
  }, [estado, fotos, linkDoArquivo]);
  useEffect(() => {
    if (!fotoAberta) return;
    const fechar = (e: KeyboardEvent) => e.key === 'Escape' && setFotoAberta(null);
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [fotoAberta]);
  // lazer no 3D: marcadores com o nome; tocar num marcador voa até ele
  useEffect(() => {
    if (estado !== 'pronto') return;
    viewer.current?.definirLazer(itensLazer.map((l) => ({ id: l.id, x: l.x, y: l.y, z: l.z, rotulo: rotuloDoPonto(l), agua: l.categoria === 'piscina' })));
  }, [estado, itensLazer]);
  useEffect(() => {
    if (estado !== 'pronto') return;
    viewer.current?.aoSelecionarLazer((id) => {
      viewer.current?.voarParaLazer(id);
      setPontoLazer(id);
    });
  }, [estado]);
  // gestão: o próximo clique no 3D (chão, laje ou terraço) marca o espaço
  useEffect(() => {
    const v = viewer.current;
    if (!v || estado !== 'pronto' || !gerirLazer || !marcandoLazer) return;
    const d = marcandoLazer;
    const cm = (n: number) => Math.round(n * 100) / 100;
    v.aoClicarPiso((ponto) => {
      setMarcandoLazer(null);
      void gerirLazer.criar({ ...d, x: cm(ponto.x), y: cm(ponto.y), z: cm(ponto.z) }).then((r) => {
        if (r.item) {
          setItensLazer((l) => [...l, r.item!]);
          setErroLazer(null);
        } else setErroLazer(r.erro ?? 'Não foi possível salvar o ponto agora.');
      });
    });
    return () => v.aoClicarPiso(null);
  }, [marcandoLazer, estado, gerirLazer]);
  const removerPontoLazer = async (id: string) => {
    if (!gerirLazer) return;
    const r = await gerirLazer.remover(id);
    if (r.erro) return setErroLazer(r.erro);
    setErroLazer(null);
    setItensLazer((l) => l.filter((x) => x.id !== id));
    setPontoLazer((p) => (p === id ? null : p));
  };
  // tour "Conheça o lazer em 2 min": um ponto de cada vez (sozinho ou no "Próximo"), checklist e evento no fim
  const tourRef = useRef(tour);
  tourRef.current = tour;
  const irAoPontoLazer = (indice: number, emTour: boolean) => {
    const item = itensLazer[indice];
    if (!item) return;
    setVista(null);
    setInterior(null);
    viewer.current?.voarParaLazer(item.id);
    setPontoLazer(item.id);
    if (emTour) setTour((t) => ({ indice, vistos: t?.vistos.includes(item.id) ? t.vistos : [...(t?.vistos ?? []), item.id], completo: false }));
  };
  const proximoDoTour = () => {
    const t = tourRef.current;
    if (!t || t.completo) return;
    if (t.indice + 1 < itensLazer.length) return irAoPontoLazer(t.indice + 1, true);
    setTour({ ...t, completo: true });
    setPontoLazer(null);
    aoEvento?.({ tipo: 'tour_lazer' });
  };
  useEffect(() => {
    if (!tour || tour.completo) return;
    const id = setTimeout(proximoDoTour, passoDoTourMs(itensLazer.length));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.indice, tour?.completo]);
  const encerrarLazer = () => {
    setTour(null);
    setPontoLazer(null);
    viewer.current?.visaoGeral();
  };
  const entrarEmVr = async () => {
    setErroImersivo(null);
    if (!(await viewer.current?.entrarEmVr())) setErroImersivo('O óculos não abriu a visita. Confira se ele está ligado e se o navegador dele tem permissão para VR.');
  };
  const entrarEmAr = async () => {
    const camada = sobreposicaoAr.current;
    if (!camada) return;
    setErroImersivo(null);
    camada.hidden = false; // antes do pedido: o navegador mostra esta camada por cima da câmera
    if (!(await viewer.current?.entrarEmAr(camada))) {
      camada.hidden = true;
      setErroImersivo('A câmera não abriu. Permita o uso da câmera para ver a maquete na mesa.');
    }
  };

  // um viewer por modelo
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const c = inicial.current;
    setEstado('carregando');
    const v = criarViewer(el, { unidades: c.unidades, modeloUrl: c.modeloUrl, rotacaoGraus: c.rotacaoGraus, estiloDecorado: c.estiloDecorado, lat: c.lat ?? undefined, lon: c.lon ?? undefined, decodificadores: DECODIFICADORES,
      ...(c.qualidadeFixa !== null ? { qualidadeInicial: c.qualidadeFixa, qualidadeFixa: true } : {}),
    });
    viewer.current = v;
    let vivo = true;
    v.aoSelecionar((id) => setSelecionada(id));
    // telemetria: uma vez por visita, ao sair da página (ou trocar de página dentro do site)
    let enviado = false;
    let webgpu: boolean | null = null;
    void temWebGpu().then((w) => (webgpu = w));
    const enviarTelemetria = () => {
      const m = v.metricas();
      if (!c.comTelemetria || enviado || (m.cargaMs === null && m.erros === 0)) return;
      enviado = true;
      const corpo = JSON.stringify({ predioId: c.predioId, ...m, celular: window.matchMedia('(pointer: coarse)').matches, webgpu });
      navigator.sendBeacon?.('/api/telemetria', new Blob([corpo], { type: 'application/json' }));
    };
    const aoEsconder = () => document.visibilityState === 'hidden' && enviarTelemetria();
    window.addEventListener('pagehide', enviarTelemetria);
    document.addEventListener('visibilitychange', aoEsconder);
    v.aoMudar((e) => vivo && setTelemetria(e));
    v.pronto.then(
      () => {
        if (!vivo) return;
        for (const [id, st] of Object.entries(statusAoVivoRef.current)) v.definirStatus(id, st);
        setComCorte(v.andaresComCorte());
        setEstado('pronto');
        // entorno depois do prédio: a primeira imagem não espera o OSM
        c.carregarEntorno()
          .then(async (r) => {
            if (!vivo) return;
            if (!r.entorno) return setEntorno({ tipo: r.motivo });
            const n = await v.definirEntorno(r.entorno);
            if (vivo) setEntorno({ tipo: 'pronto', predios: n, atribuicao: r.entorno.atribuicao });
          })
          .catch(() => {
            v.registrarErro();
            if (vivo) setEntorno({ tipo: 'indisponivel' });
          });
      },
      () => vivo && setEstado('erro'),
    );
    return () => {
      vivo = false;
      enviarTelemetria();
      window.removeEventListener('pagehide', enviarTelemetria);
      document.removeEventListener('visibilitychange', aoEsconder);
      viewer.current = null;
      v.destruir();
    };
  }, [chaveModelo]);

  useEffect(() => {
    if (selecionada) evento.current?.({ tipo: 'unidade', unidadeId: selecionada });
  }, [selecionada]);

  // status ao vivo: se a conexão cair, pede um endereço novo e reconecta em 5 s
  useEffect(() => {
    if (!fonteAoVivo.current) return;
    let vivo = true;
    let fonte: EventSource | null = null;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const reconectar = () => {
      setEstadoAoVivo('conectando');
      espera = setTimeout(() => void abrir(), 5000);
    };
    const abrir = async () => {
      setEstadoAoVivo('conectando');
      const url = await fonteAoVivo.current?.().catch(() => null);
      if (!vivo) return;
      if (!url) return reconectar();
      fonte = new EventSource(url);
      fonte.onopen = () => vivo && setEstadoAoVivo('conectado');
      fonte.addEventListener('conducao', (e) => setConducao(JSON.parse((e as MessageEvent<string>).data)));
      fonte.addEventListener('unidade', (e) => {
        const m = JSON.parse((e as MessageEvent<string>).data) as { id: string; status: StatusUnidade };
        setStatusAoVivo((s) => ({ ...s, [m.id]: m.status }));
        viewer.current?.definirStatus(m.id, m.status);
      });
      fonte.onerror = () => {
        fonte?.close();
        if (vivo) reconectar();
      };
    };
    void abrir();
    return () => {
      vivo = false;
      clearTimeout(espera);
      fonte?.close();
    };
  }, [predioId]);

  const unidadesAtuais = useMemo(() => unidades.map((u) => (statusAoVivo[u.id] ? { ...u, status: statusAoVivo[u.id]! } : u)), [unidades, statusAoVivo]);
  // estudo solar de cada unidade (depois do entorno: os prédios em volta fazem sombra)
  const [solar, setSolar] = useState<ReadonlyMap<string, EstudoSolar>>(() => new Map());
  const [filtroSol, setFiltroSol] = useState<PeriodoDeSol[]>([]);
  const passamBase = useMemo(() => filtrar(unidadesAtuais, filtro, favoritos), [unidadesAtuais, filtro, favoritos]);
  const passam = useMemo(
    () => (filtroSol.length ? new Set([...passamBase].filter((id) => filtroSol.includes(solar.get(id)?.periodo ?? 'pouco-sol'))) : passamBase),
    [passamBase, filtroSol, solar],
  );
  const ativo = filtroAtivo(filtro) || filtroSol.length > 0;
  // vista da janela da unidade (câmera na varanda)
  const [vista, setVista] = useState<string | null>(null);
  // comparar unidades lado a lado (até 3)
  const [comparar, setComparar] = useState<string[]>([]);
  const [podeNarrar, setPodeNarrar] = useState(false);
  useEffect(() => setPodeNarrar('speechSynthesis' in window), []);
  // dentro do apartamento (primeira pessoa) e o elevador que leva até ele
  const [interior, setInterior] = useState<string | null>(null);
  const [elevador, setElevador] = useState<{ destino: number; atual: number; nome: string } | null>(null);
  const entrar = (u: UnidadeViewer) => {
    if (elevador) return;
    setVista(null);
    const destino = Math.max(0, u.andar);
    const passos = Math.max(1, destino);
    let atual = 0;
    setElevador({ destino, atual, nome: nomeAndar.get(u.andar) ?? `${u.andar}º andar` });
    // o número do andar sobe em ~2 s (mais rápido em prédio alto), depois a porta "abre" na sala
    const t = setInterval(
      () => {
        atual = Math.min(destino, atual + 1);
        setElevador((e) => (e ? { ...e, atual } : e));
        if (atual < destino) return;
        clearInterval(t);
        setTimeout(() => {
          if (viewer.current?.entrarNaUnidade(u.id)) setInterior(u.id);
          setElevador(null);
        }, 450);
      },
      Math.max(120, 1800 / passos),
    );
  };
  const sairDoApartamento = () => {
    setInterior(null);
    viewer.current?.definirModo('orbita');
  };
  // unidades que o assistente mostrou: valem até a pessoa mexer nos filtros
  const [destaqueIA, setDestaqueIA] = useState<ReadonlySet<string> | null>(null);
  // apresentação do estande: a unidade disponível da vez
  const [vitrineDaVez, setVitrineDaVez] = useState<string | null>(null);
  useEffect(() => {
    setDestaqueIA(null);
  }, [filtro]);
  useEffect(() => {
    if (estado === 'pronto') viewer.current?.definirDestaque(vitrineDaVez ? new Set([vitrineDaVez]) : (destaqueIA ?? (ativo ? passam : null)), favoritos);
  }, [estado, passam, ativo, favoritos, destaqueIA, vitrineDaVez]);
  useEffect(() => {
    if (estado === 'pronto') viewer.current?.cortarNoAndar(andarCorte === '' ? null : Number(andarCorte));
  }, [estado, andarCorte]);
  useEffect(() => {
    if (estado === 'pronto') viewer.current?.definirSol(dataSol, horaSol);
  }, [estado, dataSol, horaSol]);
  useEffect(() => {
    if (estado === 'pronto') viewer.current?.definirClima(clima);
  }, [estado, clima]);
  // cliente: segue a câmera da consultora (e a unidade que ela abrir)
  useEffect(() => {
    if (estado !== 'pronto') return;
    if (!conducao?.ativo) {
      viewer.current?.seguirPose(null);
      setSoltou(false);
      return;
    }
    if (soltou) return viewer.current?.seguirPose(null);
    if (conducao.posicao && conducao.alvo) viewer.current?.seguirPose({ posicao: conducao.posicao, alvo: conducao.alvo });
    if (conducao.unidade !== undefined) {
      setSelecionada(conducao.unidade);
      viewer.current?.selecionar(conducao.unidade);
    }
  }, [estado, conducao, soltou]);
  // consultora: manda a câmera ~3 vezes por segundo enquanto conduz (só quando muda); ao parar, avisa o cliente
  const selecionadaRef = useRef(selecionada);
  selecionadaRef.current = selecionada;
  useEffect(() => {
    if (!conduzindo) return;
    const url = `/painel/links/${conduzindo}/conducao`;
    const enviar = (corpo: object) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), keepalive: true }).catch(() => undefined);
    let ultimo = '';
    const t = setInterval(() => {
      const pose = viewer.current?.poseCamera();
      if (!pose) return;
      const corpo = { ativo: true, ...pose, unidade: selecionadaRef.current };
      const chave = JSON.stringify(corpo);
      if (chave === ultimo) return;
      ultimo = chave;
      void enviar(corpo);
    }, 330);
    return () => {
      clearInterval(t);
      void enviar({ ativo: false });
    };
  }, [conduzindo]);
  useEffect(() => {
    if (estado === 'pronto' && entorno.tipo !== 'carregando' && viewer.current) setSolar(viewer.current.estudoSolar());
  }, [estado, entorno.tipo]);

  // estande: o próximo visitante começa do zero (sem filtro, unidade, corte ou interior do anterior)
  const reinicio = estande?.reinicio ?? 0;
  useEffect(() => {
    if (!reinicio) return;
    setFiltro(filtroVazio);
    setFiltroSol([]);
    setVista(null);
    setInterior(null);
    setElevador(null);
    setComparar([]);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSelecionada(null);
    setAndarCorte('');
    setInteriorAberto(null);
    setMostrarGiro(false);
    setDestaqueIA(null);
    setClima('limpo');
    setHoraSol(10);
    setDataSol(hoje());
    viewer.current?.visaoGeral();
    coluna.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [reinicio]);
  // apresentação: gira devagar e mostra uma unidade disponível de cada vez (8 s cada)
  const apresentando = (estande?.apresentando ?? false) && estado === 'pronto';
  const disponiveisRef = useRef<string[]>([]);
  disponiveisRef.current = unidadesAtuais.filter((u) => u.status === 'disponivel').map((u) => u.id);
  useEffect(() => {
    viewer.current?.apresentacao(apresentando);
    if (!apresentando) {
      setVitrineDaVez(null);
      return;
    }
    let i = 0;
    const proxima = () => {
      const ids = disponiveisRef.current;
      setVitrineDaVez(ids.length ? ids[i++ % ids.length]! : null);
    };
    proxima();
    const t = setInterval(proxima, 8000);
    return () => {
      clearInterval(t);
      viewer.current?.apresentacao(false);
    };
  }, [apresentando]);

  const nomeAndar = new Map(andares.map((a) => [a.numero, a.nome]));
  const quartosDisponiveis = [...new Set(unidades.map((u) => u.quartos).filter((q): q is number => q !== null))].sort((a, b) => a - b);
  // busca pelo código na lista ("1201", "12"), como no painel de unidades do vídeo 3; não mexe no 3D
  const [buscaUnidade, setBuscaUnidade] = useState('');
  const termoBusca = buscaUnidade.trim().toLowerCase();
  const lista = unidadesAtuais.filter((u) => passam.has(u.id) && (!termoBusca || u.codigo.toLowerCase().includes(termoBusca)));
  const unidade = selecionada ? unidadesAtuais.find((u) => u.id === selecionada) : undefined;
  const modo = telemetria?.modo ?? 'orbita';

  const favoritar = (id: string) => {
    const novo = alternarFavorito(favoritos, id);
    if (novo.has(id)) aoEvento?.({ tipo: 'favorito', unidadeId: id });
    setFavoritos(novo);
    salvarFavoritos(predioId, novo);
  };
  const [baixando, setBaixando] = useState(false);
  const [giro, setGiro] = useState<Giro | null>(null);
  const [mostrarGiro, setMostrarGiro] = useState(false);
  const [quadroGiro, setQuadroGiro] = useState(0);
  const [progressoGiro, setProgressoGiro] = useState<string | null>(null);
  const [giroFoto, setGiroFoto] = useState<Giro | null>(null);
  const [tipoGiro, setTipoGiro] = useState<'leve' | 'fotorrealista'>('leve');
  const [erroGiro, setErroGiro] = useState<string | null>(null);
  const mostrar = (tipo: 'leve' | 'fotorrealista', g: Giro) => {
    setTipoGiro(tipo);
    setQuadroGiro((q) => q % g.quadros.length);
    setMostrarGiro(true);
  };
  /** Baixa o ZIP do giro renderizado (uma vez por visita) e abre no mesmo tocador do giro leve. */
  const abrirGiroFoto = async () => {
    if (!giroRenderizado) return;
    if (giroFoto) return mostrar('fotorrealista', giroFoto);
    setErroGiro(null);
    setProgressoGiro('Baixando o giro fotorrealista…');
    try {
      const url = await linkDoArquivo(giroRenderizado.arquivoId);
      const r = url ? await fetch(url) : null;
      if (!r?.ok) throw new Error('Não foi possível baixar o giro.');
      const g = giroDoZip(new Uint8Array(await r.arrayBuffer()), giroRenderizado.unidades);
      setGiroFoto(g);
      mostrar('fotorrealista', g);
    } catch (e) {
      setErroGiro((e as Error).message);
    } finally {
      setProgressoGiro(null);
    }
  };
  const abrirGiro = async () => {
    const v = viewer.current;
    if (!v) return;
    if (giro) return mostrar('leve', giro); // já gerado nesta visita
    setProgressoGiro('Preparando…');
    try {
      const g = await v.gerarGiro({ quadros: 72, aoProgredir: (feitos, total) => setProgressoGiro(`Gerando ${feitos} de ${total} imagens…`) });
      setGiro(g);
      mostrar('leve', g);
    } catch {
      v.registrarErro();
    } finally {
      setProgressoGiro(null);
    }
  };
  // foto fotorrealista (path tracing): a imagem revela na tela; cancelar mexendo no botão
  const [foto, setFoto] = useState<{ feitas: number; total: number } | null>(null);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const cancelarFoto = useRef<AbortController | null>(null);
  const tirarFoto = async () => {
    const v = viewer.current;
    if (!v) return;
    setErroFoto(null);
    const controle = new AbortController();
    cancelarFoto.current = controle;
    setFoto({ feitas: 0, total: amostrasFoto });
    try {
      const png = await v.fotoRealista({ empresa, predio: predioNome, data: new Date() }, { amostras: amostrasFoto, sinal: controle.signal, aoProgredir: (feitas, total) => setFoto({ feitas, total }) });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(png);
      link.download = `${predioNome.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-foto-${hoje()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        v.registrarErro();
        setErroFoto(giroRenderizado ? 'Este aparelho não fez a foto fotorrealista. Use o giro 360° fotorrealista.' : 'Este aparelho não fez a foto fotorrealista. Tente num computador com placa de vídeo.');
      }
    } finally {
      cancelarFoto.current = null;
      setFoto(null);
    }
  };
  const baixarImagem = async () => {
    const v = viewer.current;
    if (!v) return;
    setBaixando(true);
    try {
      const png = await v.capturar({ empresa, predio: predioNome, data: new Date() });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(png);
      link.download = `${predioNome.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${hoje()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } finally {
      setBaixando(false);
    }
  };
  const voar = (id: string) => {
    setVista(null);
    setInterior(null);
    setSelecionada(id);
    viewer.current?.voarPara(id);
  };
  // pedido por texto da gestão ("foto do pôr do sol da 1201"): abre na vista da unidade, na hora pedida
  const inicioFeito = useRef(false);
  useEffect(() => {
    if (estado !== 'pronto' || inicioFeito.current || !inicio) return;
    inicioFeito.current = true;
    if (inicio.hora !== null) setHoraSol(inicio.hora);
    if (inicio.unidadeId) {
      setSelecionada(inicio.unidadeId);
      if (viewer.current?.vistaDaUnidade(inicio.unidadeId)) setVista(inicio.unidadeId);
    }
  }, [estado, inicio]);
  // corretora virtual: personagem na frente da unidade de que o assistente fala, acenando enquanto fala
  const [corretoraLigada, setCorretoraLigada] = useState(false);
  const [corretoraFalando, setCorretoraFalando] = useState(false);
  useEffect(() => {
    if (estado !== 'pronto') return;
    viewer.current?.mostrarCorretora(corretoraLigada ? { unidadeId: selecionada, falando: corretoraFalando } : null);
  }, [estado, corretoraLigada, corretoraFalando, selecionada]);
  // missões e conquistas: cada uma conta uma vez por visita, vira evento e mostra o selo
  const [missoes, setMissoes] = useState<ReadonlySet<IdMissao>>(() => new Set());
  const [conquista, setConquista] = useState<string | null>(null);
  // fora do atualizador de estado: o modo estrito do React roda o atualizador duas vezes (evento em dobro)
  const feitas = useRef(new Set<IdMissao>());
  const completar = (id: IdMissao) => {
    if (feitas.current.has(id)) return;
    feitas.current.add(id);
    aoEvento?.({ tipo: 'missao', missao: id });
    setConquista(MISSOES.find((x) => x.id === id)!.titulo);
    setMissoes(new Set(feitas.current));
  };
  useEffect(() => {
    if (!conquista) return;
    const t = setTimeout(() => setConquista(null), 4000);
    return () => clearTimeout(t);
  }, [conquista]);
  const [vistasParaMissao, setVistasParaMissao] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (selecionada) setVistasParaMissao((v) => (v.has(selecionada) ? v : new Set([...v, selecionada])));
  }, [selecionada]);
  const tipologias = progressoTipologias(vistasParaMissao, unidades);
  useEffect(() => {
    if (tipologias.meta > 0 && tipologias.vistos >= tipologias.meta) completar('tipologias');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- completar só muda o estado das missões
  }, [tipologias.vistos, tipologias.meta]);
  useEffect(() => {
    if (interior) completar('por_dentro');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interior]);
  useEffect(() => {
    if (ehPorDoSol(horaSol, vista !== null || interior !== null)) completar('por_do_sol');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horaSol, vista, interior]);
  useEffect(() => {
    if (tour?.completo) completar('lazer');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.completo]);
  const caminhada = useRef<{ total: number; ultimo: { x: number; z: number } | null }>({ total: 0, ultimo: null });
  useEffect(() => {
    if (!telemetria || telemetria.modo !== 'primeira-pessoa') {
      caminhada.current.ultimo = null;
      return;
    }
    const c = caminhada.current;
    c.total = somarCaminhada(c.total, c.ultimo, telemetria.posicao);
    c.ultimo = { x: telemetria.posicao.x, z: telemetria.posicao.z };
    if (c.total >= PASSEIO_M) completar('a_pe');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telemetria]);

  // comandos por texto/voz (e os que a IA pede): cada ação mexe só na tela; devolve o que não deu para fazer
  const [perguntaAssistente, setPerguntaAssistente] = useState<{ texto: string; vez: number } | null>(null);
  const executarComandos = (acoes: AcaoComando[]): string[] => {
    const problemas: string[] = [];
    for (const a of acoes) {
      switch (a.tipo) {
        case 'limpar':
          setFiltro(filtroVazio());
          setFiltroSol([]);
          setDestaqueIA(null);
          break;
        case 'filtro':
          setDestaqueIA(null);
          setFiltro((f) => ({
            ...f,
            ...(a.quartos ? { quartos: a.quartos } : {}),
            ...(a.precoMax !== undefined ? { precoMax: a.precoMax } : {}),
            ...(a.areaMin !== undefined ? { areaMin: a.areaMin } : {}),
            ...(a.status ? { status: a.status } : {}),
            ...(a.favoritos ? { somenteFavoritos: true } : {}),
          }));
          if (a.sol) setFiltroSol(a.sol);
          break;
        case 'hora':
          setHoraSol(a.hora);
          break;
        case 'estacao':
          setDataSol(`${new Date().getFullYear()}-${a.estacao === 'inverno' ? '06' : '12'}-21`);
          break;
        case 'clima':
          setClima(a.clima);
          break;
        case 'tour_lazer':
          if (!itensLazer.length) problemas.push('Este empreendimento ainda não tem o lazer marcado.');
          else {
            setTour({ indice: 0, vistos: [], completo: false });
            irAoPontoLazer(0, true);
          }
          break;
        case 'lazer': {
          const alvo = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
          const i = itensLazer.findIndex((l) => (a.categoria && l.categoria === a.categoria) || (a.nome && alvo(l.nome).includes(alvo(a.nome))));
          if (i < 0) problemas.push(`${a.nome || 'Esse espaço'} não está no lazer deste empreendimento.`);
          else irAoPontoLazer(i, false);
          break;
        }
        case 'unidade': {
          const u = unidadesAtuais.find((x) => x.codigo.toUpperCase() === a.codigo.toUpperCase());
          if (!u) {
            problemas.push(`Não há unidade ${a.codigo} neste prédio.`);
            break;
          }
          if (a.acao === 'entrar') {
            setSelecionada(u.id);
            entrar(u);
          } else if (a.acao === 'vista') {
            setSelecionada(u.id);
            if (viewer.current?.vistaDaUnidade(u.id)) setVista(u.id);
            else problemas.push(`A ${u.codigo} não tem janela para fora no 3D.`);
          } else voar(u.id);
          break;
        }
        case 'corte':
          setAndarCorte(a.andar === null ? '' : String(a.andar));
          break;
        case 'modo':
          viewer.current?.definirModo(a.modo);
          break;
        case 'separar_andares':
          viewer.current?.separarAndares(a.ligado);
          setSeparados(a.ligado);
          break;
        case 'visao_geral':
          setVista(null);
          setInterior(null);
          viewer.current?.visaoGeral();
          break;
        case 'som':
          void viewer.current?.definirSom(a.ligado);
          break;
      }
    }
    return problemas;
  };
  const aoAcaoIA = (a: AcaoAssistente) => {
    if (a.tipo === 'contato') return aoPedirContato?.(a.motivo, a.unidade);
    if (a.tipo === 'comandos') return void executarComandos(a.acoes);
    setDestaqueIA(a.unidades.length ? new Set(a.unidades) : null);
    if (a.focar) voar(a.focar);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
      {/* camada por cima da câmera no AR (o navegador a mostra em tela cheia durante a sessão) */}
      <div ref={sobreposicaoAr} hidden data-testid="camada-ar" className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-transparent p-4 text-white">
        <p className="rounded-2xl bg-black/60 px-4 py-2 text-center text-sm">Aponte para a mesa e toque para colocar a maquete. Com dois dedos: aumentar, diminuir e girar.</p>
        <button type="button" onClick={() => void viewer.current?.sairDoImersivo()} className="rounded-full bg-white px-6 py-3 font-semibold text-slate-900 shadow">
          Sair da maquete
        </button>
      </div>
      <div
        data-testid="vitrine-3d"
        data-estado={estado}
        data-modo={modo}
        data-corte={andarCorte || 'nenhum'}
        data-posicao={telemetria ? `${telemetria.posicao.x.toFixed(1)},${telemetria.posicao.z.toFixed(1)}` : ''}
        data-entorno={entorno.tipo === 'pronto' ? String(entorno.predios) : entorno.tipo}
        data-giro={mostrarGiro ? 'pronto' : progressoGiro ? 'gerando' : 'fechado'}
        data-destaque-ia={destaqueIA ? [...destaqueIA].sort().join(',') : ''}
        data-ao-vivo={estadoAoVivo}
        data-clima={clima}
        data-vista={vista ?? ''}
        data-interior={interior ?? ''}
        data-conducao={conducao?.ativo ? (soltou ? 'solto' : 'seguindo') : conduzindo ? 'conduzindo' : ''}
        data-elevador={elevador ? String(elevador.atual) : ''}
        data-acabamento={telemetria?.acabamento ? 'ligado' : 'desligado'}
        data-imersivo={emImersivo ?? ''}
        data-lazer={itensLazer.length}
        data-moradores={telemetria?.moradores ?? 0}
        data-decorado={telemetria?.decorado ?? 0}
        data-fotos={qtdFotos}
        data-missoes={missoes.size}
        data-corretora={telemetria?.corretora ?? 'fora'}
        data-outros={telemetria?.outros ?? 0}
        data-explosao={telemetria?.explosao ?? 0}
        data-etiquetas={telemetria?.etiquetas ?? 0}
        data-terceira={telemetria?.terceiraPessoa ? 'sim' : 'nao'}
        data-boneco={telemetria?.boneco ?? ''}
        data-no-ar={telemetria?.noAr ? 'sim' : 'nao'}
        data-nivel={telemetria?.nivel ?? ''}
        data-som={telemetria?.som ? 'ligado' : 'desligado'}
        data-marcando-lazer={marcandoLazer ? 'sim' : ''}
        data-apresentacao={apresentando ? 'ligada' : 'desligada'}
        data-unidade-da-vez={vitrineDaVez ?? ''}
        className={`relative ${estande ? 'h-[calc(100dvh-7rem)]' : 'h-[70vh]'} min-h-96 overflow-hidden rounded-2xl border border-borda bg-fundo lg:sticky lg:top-6`}
      >
        <canvas
          ref={canvas}
          className="block h-full w-full touch-none"
          aria-label="Prédio em 3D. Arraste para girar, role para aproximar, toque numa unidade para ver os detalhes."
        />
        {estado === 'carregando' && <p className="absolute inset-0 grid place-items-center text-suave">Carregando o 3D…</p>}
        {(tour || pontoLazer) && !conducao?.ativo && (
          <PainelDoPonto item={itensLazer.find((l) => l.id === pontoLazer) ?? null} tour={tour} total={itensLazer.length} aoProximo={proximoDoTour} aoEncerrar={encerrarLazer} />
        )}
        {conducao?.ativo && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-16">
            <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-acento px-3 py-1.5 text-center text-sm text-acento-texto shadow" role="status">
              <span>{soltou ? 'A consultora está conduzindo a visita.' : 'A consultora está conduzindo a visita: você vê o que ela mostra.'}</span>
              <button type="button" onClick={() => setSoltou((x) => !x)} className="rounded-full bg-white px-3 py-1 font-semibold text-slate-900 hover:bg-white/90">
                {soltou ? 'Seguir a consultora' : 'Explorar sozinho'}
              </button>
            </div>
          </div>
        )}
        {modo === 'primeira-pessoa' && telemetria && viewer.current && !elevador && (
          <Minimapa mapa={viewer.current.mapaDoLote()} posicao={{ x: telemetria.posicao.x, z: telemetria.posicao.z }} direcao={telemetria.direcao} />
        )}
        {elevador && (
          <div data-testid="elevador" className="absolute inset-0 z-20 grid place-items-center bg-slate-950/90 text-white" role="status" aria-live="polite">
            <div className="grid justify-items-center gap-2">
              <span className="text-sm uppercase tracking-[0.3em] text-white/70">Elevador</span>
              <span className="text-7xl font-bold tabular-nums">{elevador.atual === 0 ? 'T' : `${elevador.atual}º`}</span>
              <span className="text-white/80">{elevador.atual < elevador.destino ? 'Subindo…' : `${elevador.nome}: a porta está abrindo`}</span>
            </div>
          </div>
        )}
        {interior && !elevador && (
          <div className="pointer-events-none absolute inset-x-0 bottom-9 z-10 flex justify-center px-28">
            {/* o toque passa pela faixa (é chão para andar, em tela pequena ela cobre o piso); só o botão recebe */}
            <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-black/65 px-3 py-1.5 text-center text-xs text-white backdrop-blur sm:text-sm">
              <span>
                Dentro da unidade {unidadesAtuais.find((u) => u.id === interior)?.codigo} · toque no chão para andar · arraste para olhar
              </span>
              <button type="button" onClick={sairDoApartamento} className="pointer-events-auto rounded-full bg-white px-3 py-1 font-semibold text-slate-900 hover:bg-white/90">
                Sair do apartamento
              </button>
            </div>
          </div>
        )}
        {apresentando && <Apresentacao unidade={unidadesAtuais.find((u) => u.id === vitrineDaVez) ?? null} nomeAndar={(n) => nomeAndar.get(n) ?? `${n}º andar`} />}
        {estado === 'erro' && <p className="absolute inset-0 grid place-items-center text-perigo">Não foi possível carregar o modelo 3D.</p>}
        {telemetria && (
          <>
            <Bussola rumo={telemetria.rumo} />
            {/* número técnico: no estande, quem vê é o visitante (o desempenho vai para o painel) */}
            {!estande && (
              <p data-testid="qualidade" className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
                {telemetria.fps} FPS · qualidade {ROTULO_NIVEL[telemetria.nivel]}
              </p>
            )}
          </>
        )}
        {entorno.tipo === 'pronto' && entorno.predios > 0 &&
          (estande ? (
            // no estande não há para onde navegar: a atribuição (licença do OSM) fica só como texto
            <span className="absolute bottom-2 right-2 rounded bg-white/85 px-2 py-0.5 text-[11px] text-slate-800">{entorno.atribuicao}</span>
          ) : (
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="absolute bottom-2 right-2 rounded bg-white/85 px-2 py-0.5 text-[11px] text-slate-800 hover:underline"
            >
              {entorno.atribuicao}
            </a>
          ))}
        {mostrarGiro && (tipoGiro === 'fotorrealista' ? giroFoto : giro) && (
          <Giro360
            giro={(tipoGiro === 'fotorrealista' ? giroFoto : giro)!}
            fotorrealista={tipoGiro === 'fotorrealista'}
            quadro={quadroGiro}
            aoMudarQuadro={setQuadroGiro}
            aoSelecionar={setSelecionada}
            aoFechar={() => setMostrarGiro(false)}
          />
        )}
        {progressoGiro && <p className="absolute inset-x-0 bottom-12 mx-auto w-fit rounded-md bg-black/70 px-3 py-1 text-sm text-white">{progressoGiro}</p>}
        {conquista && (
          <p role="status" data-testid="conquista" className="pointer-events-none absolute inset-x-0 top-14 mx-auto w-fit rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900 shadow-lg">
            🏅 Conquista: {conquista}
          </p>
        )}
        {fotoAberta && (
          <div role="dialog" aria-modal="true" aria-label={`Foto: ${fotoAberta.nome}`} data-testid="foto-aberta" className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" onClick={() => setFotoAberta(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- link assinado temporário, fora do otimizador de imagens */}
            <img src={fotoAberta.url} alt={fotoAberta.nome} className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl" />
            <button type="button" className="absolute right-4 top-4 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-black" onClick={() => setFotoAberta(null)}>
              Fechar
            </button>
          </div>
        )}
        {interiorAberto && <InteriorSplat arquivo={interiorAberto} linkDoArquivo={linkDoArquivo} aoFechar={() => setInteriorAberto(null)} />}
        {modo === 'primeira-pessoa' && <Joystick aoMover={(e) => viewer.current?.definirEntrada(e)} />}
      </div>

      {/* estande: a coluna rola sozinha; o 3D e o cabeçalho (com o QR) ficam sempre na tela */}
      <div ref={coluna} className={`grid gap-4 ${estande ? 'lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1' : ''}`}>
        {unidade && (
          <Cartao titulo={`Unidade ${unidade.codigo}`}>
            <div data-testid="unidade-selecionada" className="grid gap-3 text-sm">
              <span className={`w-fit rounded px-2 py-0.5 text-xs font-semibold ${COR_STATUS[unidade.status]}`}>{ROTULO_STATUS[unidade.status]}</span>
              {corretor && <FalarComCorretor numero={corretor.whatsapp} nomeCorretor={corretor.nome} empreendimento={corretor.empreendimento} unidade={unidade.codigo} />}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                <dt className="text-suave">Andar</dt>
                <dd>{nomeAndar.get(unidade.andar) ?? unidade.andar}</dd>
                <dt className="text-suave">Área</dt>
                <dd>{unidade.areaM2 === null ? '—' : `${unidade.areaM2.toLocaleString('pt-BR')} m²`}</dd>
                <dt className="text-suave">Quartos</dt>
                <dd>{unidade.quartos ?? '—'}</dd>
                <dt className="text-suave">Preço</dt>
                <dd>{brl(unidade.preco)}</dd>
              </dl>
              {solar.get(unidade.id) && (
                <div data-testid="sol-unidade" className="grid gap-1 rounded-lg bg-fundo px-3 py-2">
                  <span className="font-semibold">☀ {ROTULO_SOL[solar.get(unidade.id)!.periodo]}</span>
                  <span className="text-xs text-suave">
                    Sol direto na janela: {horas(solar.get(unidade.id)!.inverno)} no inverno · {horas(solar.get(unidade.id)!.equinocio)} no outono/primavera ·{' '}
                    {horas(solar.get(unidade.id)!.verao)} no verão{entorno.tipo === 'pronto' ? ', com a sombra dos prédios em volta' : ''}.
                  </span>
                </div>
              )}
              {unidade.status === 'disponivel' && unidade.preco !== null && <SimuladorFinanciamento key={unidade.id} preco={unidade.preco} />}
              <div className="flex flex-wrap gap-2">
                <Botao type="button" variante="secundario" onClick={() => favoritar(unidade.id)} aria-pressed={favoritos.has(unidade.id)}>
                  {favoritos.has(unidade.id) ? '★ Favorita' : '☆ Favoritar'}
                </Botao>
                <Botao type="button" variante="secundario" onClick={() => voar(unidade.id)}>
                  Ir até ela
                </Botao>
                <Botao
                  type="button"
                  variante="secundario"
                  aria-pressed={comparar.includes(unidade.id)}
                  disabled={!comparar.includes(unidade.id) && comparar.length >= MAX_COMPARAR}
                  onClick={() => setComparar((c) => (c.includes(unidade.id) ? c.filter((x) => x !== unidade.id) : [...c, unidade.id]))}
                >
                  {comparar.includes(unidade.id) ? '✓ Comparando' : 'Comparar'}
                </Botao>
                {podeNarrar && (
                  <Botao type="button" variante="secundario" onClick={() => narrar(textoDaUnidade(unidade, nomeAndar.get(unidade.andar) ?? `${unidade.andar}º andar`, solar.get(unidade.id)))}>
                    Ouvir
                  </Botao>
                )}
                {interior !== unidade.id && (
                  <Botao type="button" variante="secundario" disabled={estado !== 'pronto' || elevador !== null} onClick={() => entrar(unidade)}>
                    Entrar no apartamento
                  </Botao>
                )}
                {solar.has(unidade.id) &&
                  (vista === unidade.id ? (
                    <Botao
                      type="button"
                      variante="secundario"
                      onClick={() => {
                        setVista(null);
                        viewer.current?.visaoGeral();
                      }}
                    >
                      Voltar ao prédio
                    </Botao>
                  ) : (
                    <Botao type="button" onClick={() => viewer.current?.vistaDaUnidade(unidade.id) && setVista(unidade.id)}>
                      Ver a vista desta unidade
                    </Botao>
                  ))}
              </div>
            </div>
          </Cartao>
        )}

        {comparar.length >= 2 && (
          <Cartao titulo="Comparar unidades">
            <div className="overflow-x-auto" data-testid="comparador">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="py-1 pr-2 font-medium text-suave" scope="col">
                      <span className="sr-only">Item</span>
                    </th>
                    {comparar.map((id) => (
                      <th key={id} scope="col" className="py-1 pr-2 font-semibold">
                        {unidadesAtuais.find((u) => u.id === id)?.codigo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Situação', (u: UnidadeViewer) => ROTULO_STATUS[u.status]],
                      ['Andar', (u: UnidadeViewer) => nomeAndar.get(u.andar) ?? String(u.andar)],
                      ['Quartos', (u: UnidadeViewer) => (u.quartos === null ? '—' : String(u.quartos))],
                      ['Área', (u: UnidadeViewer) => (u.areaM2 === null ? '—' : `${u.areaM2.toLocaleString('pt-BR')} m²`)],
                      ['Preço', (u: UnidadeViewer) => brl(u.preco)],
                      ['Preço por m²', (u: UnidadeViewer) => (u.preco !== null && u.areaM2 ? brl(Math.round(u.preco / u.areaM2)) : '—')],
                      ['Sol', (u: UnidadeViewer) => (solar.get(u.id) ? ROTULO_SOL[solar.get(u.id)!.periodo] : '—')],
                      ['Sol no inverno', (u: UnidadeViewer) => (solar.get(u.id) ? horas(solar.get(u.id)!.inverno) : '—')],
                    ] as const
                  ).map(([rotulo, valor]) => (
                    <tr key={rotulo} className="border-t border-borda">
                      <th scope="row" className="py-1 pr-2 font-normal text-suave">
                        {rotulo}
                      </th>
                      {comparar.map((id) => {
                        const u = unidadesAtuais.find((x) => x.id === id);
                        return (
                          <td key={id} className="py-1 pr-2">
                            {u ? valor(u) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <Botao type="button" variante="secundario" className="mt-2" onClick={() => setComparar([])}>
                Limpar comparação
              </Botao>
            </div>
          </Cartao>
        )}
        {linksParaConduzir.length > 0 && (
          <Cartao titulo="Visita guiada ao vivo">
            <div className="grid gap-3 text-sm" data-testid="conduzir">
              <p className="text-suave">Ligue com o cliente e conduza: quem estiver com o link aberto vê exatamente o que você mostra aqui, em tempo real.</p>
              {conduzindo ? (
                <Botao type="button" variante="perigo" onClick={() => setConduzindo(null)}>
                  Encerrar visita guiada
                </Botao>
              ) : (
                <>
                  <Selecao id="link-conduzir" rotulo="Link do cliente" value={linkEscolhido} onChange={(e) => setLinkEscolhido(e.target.value)}>
                    <option value="">Escolha…</option>
                    {linksParaConduzir.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.titulo ?? 'Link sem nome'}
                      </option>
                    ))}
                  </Selecao>
                  <Botao type="button" disabled={!linkEscolhido} onClick={() => setConduzindo(linkEscolhido)}>
                    Conduzir ao vivo
                  </Botao>
                </>
              )}
            </div>
          </Cartao>
        )}
        {salaUrl && (
          <Cartao titulo="Visita em grupo">
            <VisitaEmGrupo url={salaUrl} viewer={viewer} pronto={estado === 'pronto'} />
          </Cartao>
        )}
        <Cartao titulo={`Missões · ${missoes.size} de ${MISSOES.length}`}>
          <ul className="grid gap-2 text-sm" data-testid="missoes" data-feitas={missoes.size}>
            {MISSOES.map((m) => (
              <li key={m.id} className="flex items-start gap-2" data-missao={m.id} data-feita={missoes.has(m.id) ? 'sim' : 'nao'}>
                <span aria-hidden className={missoes.has(m.id) ? 'text-amber-500' : 'text-suave'}>
                  {missoes.has(m.id) ? '🏅' : '○'}
                </span>
                <span>
                  <span className={missoes.has(m.id) ? 'font-semibold' : ''}>{m.titulo}</span>
                  {m.id === 'tipologias' && !missoes.has(m.id) && tipologias.meta > 0 && <span className="text-suave"> ({tipologias.vistos} de {tipologias.meta})</span>}
                  {!missoes.has(m.id) && <span className="block text-xs text-suave">{m.dica}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Cartao>
        <Cartao titulo="Peça o que quiser ver">
          <ComandoVitrine
            pronto={estado === 'pronto'}
            aoExecutar={executarComandos}
            aoPerguntar={assistenteUrl ? (texto) => setPerguntaAssistente((p) => ({ texto, vez: (p?.vez ?? 0) + 1 })) : null}
          />
        </Cartao>
        {assistenteUrl && (
          <Cartao titulo="Pergunte ao assistente">
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={corretoraLigada} onChange={(e) => setCorretoraLigada(e.target.checked)} />
              Corretora virtual (aparece no 3D e fala as respostas)
            </label>
            <Assistente url={assistenteUrl} aoAcao={aoAcaoIA} pergunta={perguntaAssistente} voz={corretoraLigada} aoFalar={setCorretoraFalando} />
          </Cartao>
        )}
        <Cartao titulo="Filtros">
          <div className="grid gap-4 text-sm">
            {quartosDisponiveis.length > 0 && (
              <fieldset className="grid gap-2">
                <legend className="mb-1 font-medium">Quartos</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {quartosDisponiveis.map((q) => (
                    <label key={q} className="flex min-h-10 items-center gap-2">
                      <input type="checkbox" checked={filtro.quartos.includes(q)} onChange={() => setFiltro({ ...filtro, quartos: alternar(filtro.quartos, q) })} />
                      {q} {q === 1 ? 'quarto' : 'quartos'}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Campo id="area-min" rotulo="Área mínima (m²)" type="number" min={0} inputMode="numeric" value={filtro.areaMin ?? ''} onChange={(e) => setFiltro({ ...filtro, areaMin: numeroOuNulo(e.target.value) })} />
              <Campo id="preco-max" rotulo="Preço máximo (R$)" type="number" min={0} inputMode="numeric" value={filtro.precoMax ?? ''} onChange={(e) => setFiltro({ ...filtro, precoMax: numeroOuNulo(e.target.value) })} />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 font-medium">Status</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {STATUS_UNIDADE.map((s) => (
                  <label key={s} className="flex min-h-10 items-center gap-2">
                    <input type="checkbox" checked={filtro.status.includes(s)} onChange={() => setFiltro({ ...filtro, status: alternar(filtro.status, s) })} />
                    {ROTULO_STATUS[s]}
                  </label>
                ))}
              </div>
            </fieldset>
            {solar.size > 0 && (
              <fieldset className="grid gap-2">
                <legend className="mb-1 font-medium">Sol</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {(['manha', 'tarde', 'dia-todo'] as const).map((p) => (
                    <label key={p} className="flex min-h-10 items-center gap-2">
                      <input type="checkbox" checked={filtroSol.includes(p)} onChange={() => setFiltroSol((f) => alternar(f, p))} />
                      {ROTULO_SOL[p]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="flex min-h-10 items-center gap-2">
              <input type="checkbox" checked={filtro.somenteFavoritos} onChange={(e) => setFiltro({ ...filtro, somenteFavoritos: e.target.checked })} />
              Só favoritas ({favoritos.size})
            </label>
            {ativo && (
              <Botao
                type="button"
                variante="secundario"
                onClick={() => {
                  setFiltro(filtroVazio());
                  setFiltroSol([]);
                }}
              >
                Limpar filtros
              </Botao>
            )}
          </div>
        </Cartao>

        <Cartao titulo="Unidades">
          <label htmlFor="busca-unidade" className="mb-2 grid gap-1 text-sm">
            <span className="sr-only">Buscar unidade pelo número</span>
            <input
              id="busca-unidade"
              type="search"
              inputMode="numeric"
              value={buscaUnidade}
              onChange={(e) => setBuscaUnidade(e.target.value)}
              placeholder="Buscar pelo número (ex.: 1201)"
              className="rounded-lg border border-borda bg-superficie px-3 py-2"
            />
          </label>
          <p data-testid="contagem-filtro" className="mb-3 text-sm text-suave">
            {lista.length} de {unidades.length} unidades
          </p>
          <ul className="grid max-h-72 gap-1 overflow-y-auto" data-testid="lista-vitrine">
            {lista.map((u) => (
              <li key={u.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => voar(u.id)}
                  className={`flex min-h-10 flex-1 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-fundo ${u.id === selecionada ? 'border-acento' : 'border-borda'}`}
                >
                  <span className="font-semibold">{u.codigo}</span>
                  <span className="text-suave">{nomeAndar.get(u.andar) ?? u.andar}</span>
                  <span className={`rounded px-1.5 text-xs ${COR_STATUS[u.status]}`}>{ROTULO_STATUS[u.status]}</span>
                </button>
                <button
                  type="button"
                  onClick={() => favoritar(u.id)}
                  aria-pressed={favoritos.has(u.id)}
                  aria-label={`${favoritos.has(u.id) ? 'Desfavoritar' : 'Favoritar'} ${u.codigo}`}
                  className="min-h-10 min-w-10 rounded-lg text-lg text-amber-700 hover:bg-fundo"
                >
                  {favoritos.has(u.id) ? '★' : '☆'}
                </button>
              </li>
            ))}
          </ul>
        </Cartao>

        {interiores.length > 0 && (
          <Cartao titulo="Interior real">
            <ul className="grid gap-2">
              {interiores.map((i) => (
                <li key={i.id}>
                  <Botao
                    type="button"
                    variante="secundario"
                    className="w-full"
                    onClick={() => {
                      setInteriorAberto(i);
                      aoEvento?.({ tipo: 'interior' });
                    }}
                  >
                    Ver interior: {i.nome}
                  </Botao>
                </li>
              ))}
            </ul>
          </Cartao>
        )}

        <CartaoLazer
          itens={itensLazer}
          pronto={estado === 'pronto'}
          tour={tour}
          aoIr={(id) => irAoPontoLazer(itensLazer.findIndex((l) => l.id === id), false)}
          aoComecarTour={() => {
            setTour({ indice: 0, vistos: [], completo: false });
            irAoPontoLazer(0, true);
          }}
          gerir={gerirLazer !== null}
          marcando={marcandoLazer !== null}
          aoMarcar={(d) => {
            setErroLazer(null);
            setMarcandoLazer(d);
          }}
          aoCancelarMarcacao={() => setMarcandoLazer(null)}
          aoRemover={(id) => void removerPontoLazer(id)}
          erro={erroLazer}
        />
        <Cartao titulo="Vista">
          <div className="grid gap-4 text-sm">
            <p data-testid="aviso-entorno" className="text-suave">
              {entorno.tipo === 'carregando' && 'Carregando os prédios reais em volta…'}
              {entorno.tipo === 'pronto' && `${entorno.predios} prédios reais em volta (OpenStreetMap).`}
              {entorno.tipo === 'sem_localizacao' && 'Os prédios reais em volta aparecem quando o empreendimento tiver a localização cadastrada.'}
              {entorno.tipo === 'indisponivel' && 'Os prédios em volta não puderam ser carregados agora. O empreendimento funciona normalmente.'}
            </p>
            <Selecao id="andar-corte" rotulo="Ver até o andar (corte)" value={andarCorte} onChange={(e) => setAndarCorte(e.target.value)} disabled={estado !== 'pronto'}>
              <option value="">Prédio inteiro</option>
              {comCorte.map((n) => (
                <option key={n} value={String(n)}>
                  {nomeAndar.get(n) ?? `${n}º andar`}
                </option>
              ))}
            </Selecao>
            <Botao
              type="button"
              variante="secundario"
              aria-pressed={separados}
              disabled={estado !== 'pronto' || comCorte.length < 2}
              onClick={() => {
                viewer.current?.separarAndares(!separados);
                setSeparados(!separados);
              }}
            >
              {separados ? 'Juntar os andares' : 'Separar os andares'}
            </Botao>
            <div className="grid grid-cols-2 gap-3">
              <Campo id="data-sol" rotulo="Dia do sol" type="date" value={dataSol} onChange={(e) => e.target.value && setDataSol(e.target.value)} />
              <label htmlFor="hora-sol" className="grid gap-1">
                <span className="font-medium">Hora: {horaLegivel(horaSol)}</span>
                <input id="hora-sol" type="range" min={5} max={22} step={0.25} value={horaSol} onChange={(e) => setHoraSol(Number(e.target.value))} />
              </label>
            </div>
            <fieldset className="grid gap-2">
              <legend className="font-medium">Clima</legend>
              <div className="flex gap-2">
                {(['limpo', 'nublado'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={clima === c}
                    onClick={() => setClima(c)}
                    className={`flex-1 rounded-lg border px-3 py-2 ${clima === c ? 'border-acento bg-acento text-acento-texto' : 'border-borda hover:bg-fundo'}`}
                  >
                    {c === 'limpo' ? 'Céu limpo' : 'Nublado'}
                  </button>
                ))}
              </div>
            </fieldset>
            <Botao
              type="button"
              variante="secundario"
              disabled={estado !== 'pronto'}
              aria-pressed={telemetria?.som ?? false}
              onClick={() => void viewer.current?.definirSom(!telemetria?.som)}
            >
              {telemetria?.som ? 'Desligar o som ambiente' : 'Ligar o som ambiente'}
            </Botao>
            {giroRenderizado && (
              <Botao type="button" disabled={progressoGiro !== null} onClick={() => void abrirGiroFoto()}>
                Abrir giro 360° fotorrealista
              </Botao>
            )}
            {erroGiro && (
              <p role="alert" className="text-sm text-perigo">
                {erroGiro}
              </p>
            )}
            <Botao type="button" variante="secundario" disabled={estado !== 'pronto' || progressoGiro !== null} onClick={() => void abrirGiro()}>
              {giro ? 'Abrir giro 360° (modo leve)' : 'Gerar giro 360° (modo leve)'}
            </Botao>
            {!estande &&
              (foto ? (
                <div className="grid gap-2" data-testid="foto-revelando">
                  <p role="status">
                    Revelando a foto fotorrealista… {foto.feitas} de {foto.total}
                  </p>
                  <progress max={foto.total} value={foto.feitas} className="w-full" aria-label="Progresso da foto" />
                  <Botao type="button" variante="secundario" onClick={() => cancelarFoto.current?.abort()}>
                    Cancelar a foto
                  </Botao>
                </div>
              ) : (
                <Botao type="button" variante="secundario" disabled={estado !== 'pronto' || baixando} onClick={() => void tirarFoto()}>
                  Foto fotorrealista (PNG)
                </Botao>
              ))}
            {erroFoto && (
              <p role="alert" className="text-sm text-perigo">
                {erroFoto}
              </p>
            )}
            {!estande && (
              <Botao type="button" variante="secundario" disabled={estado !== 'pronto' || baixando} onClick={() => void baixarImagem()}>
                {baixando ? 'Gerando imagem…' : 'Baixar imagem (PNG)'}
              </Botao>
            )}
            {modo === 'orbita' ? (
              <Botao type="button" variante="secundario" disabled={estado !== 'pronto'} onClick={() => {
                  setVista(null);
                  setInterior(null);
                  viewer.current?.definirModo('primeira-pessoa');
                }}>
                Andar a pé (1ª pessoa)
              </Botao>
            ) : (
              <>
                <p className="text-suave">WASD ou setas para andar, arraste para olhar, espaço pula, Shift corre, V troca a vista. No celular, use o controle no canto da tela.</p>
                <div className="grid gap-2 rounded-lg border border-borda p-3" data-testid="modo-jogo">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={telemetria?.terceiraPessoa ?? false}
                      onChange={(e) => viewer.current?.definirTerceiraPessoa(e.target.checked)}
                    />
                    Ver o boneco (3ª pessoa)
                  </label>
                  <label className="grid gap-1">
                    <span>Boneco</span>
                    <select
                      className="rounded-lg border border-borda bg-superficie px-2 py-1"
                      value={telemetria?.boneco ?? 'ana'}
                      onChange={(e) => {
                        viewer.current?.definirBoneco(e.target.value);
                        viewer.current?.definirTerceiraPessoa(true);
                      }}
                    >
                      {BONECOS.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Botao type="button" variante="secundario" onClick={() => viewer.current?.pular()}>
                      Pular
                    </Botao>
                    <Botao type="button" variante="secundario" aria-pressed={telemetria?.correndo ?? false} onClick={() => viewer.current?.definirCorrida(!(telemetria?.correndo ?? false))}>
                      {telemetria?.correndo ? 'Andar' : 'Correr'}
                    </Botao>
                    <Botao type="button" variante="secundario" onClick={() => viewer.current?.acenar()}>
                      Acenar
                    </Botao>
                  </div>
                </div>
                <Botao type="button" variante="secundario" onClick={() => {
                  setVista(null);
                  setInterior(null);
                  viewer.current?.definirModo('orbita');
                }}>
                  Voltar para a vista de cima
                </Botao>
              </>
            )}
          </div>
        </Cartao>
        {(imersivo.vr || imersivo.ar || imersivo.quickLook) && (
          <Cartao titulo="Realidade virtual e aumentada">
            <div className="grid gap-3 text-sm" data-testid="imersivo">
              {imersivo.vr && (
                <>
                  <p className="text-suave">No óculos de VR: ande pelo empreendimento em tamanho real. Aponte o controle para o chão e solte o gatilho para ir até lá; aponte para uma unidade para abri-la.</p>
                  <Botao type="button" disabled={estado !== 'pronto' || emImersivo !== null} onClick={() => void entrarEmVr()}>
                    Ver em VR
                  </Botao>
                </>
              )}
              {imersivo.ar && (
                <>
                  <p className="text-suave">Pela câmera do celular, a maquete do prédio aparece sobre a mesa, com a situação de cada unidade.</p>
                  <Botao type="button" variante="secundario" disabled={estado !== 'pronto' || emImersivo !== null} onClick={() => void entrarEmAr()}>
                    Ver a maquete na mesa (AR)
                  </Botao>
                </>
              )}
              {imersivo.quickLook &&
                (usdz ? (
                  // Quick Look da Apple: o link precisa ter uma imagem dentro para abrir em AR
                  <a rel="ar" href={usdz} data-testid="link-quick-look" className="flex items-center gap-3 rounded-lg border border-borda px-3 py-2 font-medium hover:bg-fundo">
                    <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%230369a1' d='M12 2 3 7v10l9 5 9-5V7zm0 2.3 6.5 3.6L12 11.5 5.5 7.9zM5 9.6l6 3.3v6.8l-6-3.3zm8 10.1v-6.8l6-3.3v6.8z'/%3E%3C/svg%3E" alt="" width={28} height={28} />
                    Ver a maquete na mesa (AR do iPhone)
                  </a>
                ) : (
                  <p className="text-suave">Preparando a maquete para o AR do iPhone…</p>
                ))}
              {erroImersivo && (
                <p role="alert" className="text-perigo">
                  {erroImersivo}
                </p>
              )}
            </div>
          </Cartao>
        )}
      </div>
    </div>
  );
}

/** Estande sem ninguém mexendo: a unidade disponível da vez e o convite para tocar na tela. */
function Apresentacao({ unidade, nomeAndar }: { unidade: UnidadeViewer | null; nomeAndar: (n: number) => string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 grid justify-items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-6 pb-8 pt-24 text-center text-white">
      {unidade && (
        <div data-testid="apresentacao-unidade" className="grid gap-1">
          <p className="text-sm uppercase tracking-widest text-white/80">Disponível</p>
          <p className="text-3xl font-bold">Unidade {unidade.codigo}</p>
          <p className="text-lg">
            {[nomeAndar(unidade.andar), unidade.quartos !== null && `${unidade.quartos} quartos`, unidade.areaM2 !== null && `${unidade.areaM2} m²`, unidade.preco !== null && brl(unidade.preco)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      )}
      <p className="animate-pulse rounded-full bg-white/20 px-5 py-2 text-lg font-semibold backdrop-blur">Toque na tela para explorar</p>
    </div>
  );
}

/** Minimapa (primeira pessoa): o prédio, os vizinhos reais e você, com a seta para onde olha. */
function Minimapa({ mapa, posicao, direcao }: { mapa: { predio: Caixa; vizinhos: Caixa[]; lazer: Array<{ id: string; x: number; z: number }> }; posicao: { x: number; z: number }; direcao: { x: number; z: number } }) {
  const p = mapa.predio;
  const meio = { x: (p.minX + p.maxX) / 2, z: (p.minZ + p.maxZ) / 2 };
  const alcance = Math.max(p.maxX - p.minX, p.maxZ - p.minZ) / 2 + 35; // metros do centro até a borda do mapa
  const L = 140;
  const px = (x: number) => ((x - meio.x) / alcance) * (L / 2) + L / 2;
  const pz = (z: number) => ((z - meio.z) / alcance) * (L / 2) + L / 2;
  const caixa = (c: Caixa, cor: string, chave: string) => (
    <rect key={chave} x={px(c.minX)} y={pz(c.minZ)} width={((c.maxX - c.minX) / alcance) * (L / 2)} height={((c.maxZ - c.minZ) / alcance) * (L / 2)} fill={cor} />
  );
  const x = Math.min(L - 6, Math.max(6, px(posicao.x)));
  const y = Math.min(L - 6, Math.max(6, pz(posicao.z)));
  return (
    <svg data-testid="minimapa" width={L} height={L} viewBox={`0 0 ${L} ${L}`} className="absolute bottom-9 right-3 rounded-xl border border-white/40 bg-slate-900/70 shadow" role="img" aria-label="Minimapa: você está no ponto azul">
      {mapa.vizinhos.map((c, i) => caixa(c, '#64748b', `v${i}`))}
      {caixa(p, '#e2e8f0', 'predio')}
      {mapa.lazer.map((l) => (
        <circle key={l.id} cx={Math.min(L - 4, Math.max(4, px(l.x)))} cy={Math.min(L - 4, Math.max(4, pz(l.z)))} r={3.5} fill="#f59e0b" />
      ))}
      <circle cx={x} cy={y} r={5} fill="#0ea5e9" stroke="#fff" strokeWidth={2} />
      <line x1={x} y1={y} x2={x + direcao.x * 14} y2={y + direcao.z * 14} stroke="#0ea5e9" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

function Bussola({ rumo }: { rumo: number }) {
  return (
    <div
      data-testid="bussola"
      role="img"
      className="absolute right-3 top-3 grid h-16 w-16 place-items-center rounded-full bg-black/60 text-white"
      aria-label={`Olhando para ${pontoCardeal(rumo)} (${rumo}°)`}
    >
      {/* a agulha aponta para o norte: gira ao contrário do rumo da câmera */}
      <span className="absolute inset-1 grid justify-items-center" style={{ transform: `rotate(${-rumo}deg)` }} aria-hidden>
        <span className="text-xs font-bold text-red-300">N</span>
      </span>
      <span className="text-xs font-semibold" aria-hidden>
        {pontoCardeal(rumo)} {rumo}°
      </span>
    </div>
  );
}

const RAIO_JOYSTICK = 48;
function Joystick({ aoMover }: { aoMover: (e: { frente: number; lado: number }) => void }) {
  const [dedo, setDedo] = useState({ x: 0, y: 0 });
  const centro = useRef<{ x: number; y: number } | null>(null);
  const mover = (e: EventoPonteiro<HTMLDivElement>) => {
    if (!centro.current) return;
    const dx = e.clientX - centro.current.x;
    const dy = e.clientY - centro.current.y;
    const d = Math.hypot(dx, dy);
    const k = d > RAIO_JOYSTICK ? RAIO_JOYSTICK / d : 1;
    setDedo({ x: dx * k, y: dy * k });
    aoMover(vetorJoystick(dx, dy, RAIO_JOYSTICK));
  };
  const soltar = () => {
    centro.current = null;
    setDedo({ x: 0, y: 0 });
    aoMover({ frente: 0, lado: 0 });
  };
  return (
    <div
      data-testid="joystick"
      role="application"
      aria-label="Controle para andar: arraste na direção desejada"
      className="absolute bottom-4 left-4 h-28 w-28 touch-none rounded-full border-2 border-white/70 bg-black/40"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        centro.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        e.currentTarget.setPointerCapture(e.pointerId);
        mover(e);
      }}
      onPointerMove={mover}
      onPointerUp={soltar}
      onPointerCancel={soltar}
    >
      <span
        className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-white/80"
        style={{ transform: `translate(calc(-50% + ${dedo.x}px), calc(-50% + ${dedo.y}px))` }}
      />
    </div>
  );
}
