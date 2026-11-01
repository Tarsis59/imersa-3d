'use client';
import { useEffect, useMemo, useRef, useState, type PointerEvent as EventoPonteiro } from 'react';
import { criarViewer, filtrar, type Clima, type Giro, filtroVazio, pontoCardeal, vetorJoystick, type EstadoViewer, type Filtro, type UnidadeViewer, type Viewer } from '@imersa/viewer';
import type { StatusUnidade } from '@/lib/tipos';
import { Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { alternarFavorito, lerFavoritos, salvarFavoritos } from '@/lib/favoritos';
import { brl, COR_STATUS, ROTULO_STATUS, STATUS_UNIDADE } from '@/lib/tipos';
import { DECODIFICADORES } from '@/lib/decodificadores';
import { giroDoZip } from '@/lib/giro-zip';
import type { ResultadoEntorno } from './actions';
import { InteriorSplat } from './interior';
import { Giro360 } from './giro';
import { Assistente, type AcaoAssistente } from './assistente';

const ROTULO_NIVEL = { alto: 'alta', medio: 'média', baixo: 'baixa' } as const;
const hoje = () => new Date().toISOString().slice(0, 10);
const horaLegivel = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const filtroAtivo = (f: Filtro) => f.quartos.length > 0 || f.areaMin !== null || f.precoMax !== null || f.status.length > 0 || f.somenteFavoritos;
const numeroOuNulo = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
function alternar<T>(lista: T[], x: T): T[] {
  return lista.includes(x) ? lista.filter((y) => y !== x) : [...lista, x];
}

/** O que o visitante fez, para os números de vendas (portal público). */
export type EventoVitrine = { tipo: 'unidade' | 'favorito'; unidadeId: string } | { tipo: 'interior' };

type EstadoEntorno = { tipo: 'carregando' } | { tipo: 'pronto'; predios: number; atribuicao: string } | { tipo: 'sem_localizacao' } | { tipo: 'indisponivel' };

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
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const coluna = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const inicial = useRef({ modeloUrl, unidades, rotacaoGraus, lat, lon, projetoId, predioId, qualidadeFixa, carregarEntorno, comTelemetria });
  inicial.current = { modeloUrl, unidades, rotacaoGraus, lat, lon, projetoId, predioId, qualidadeFixa, carregarEntorno, comTelemetria };
  const evento = useRef(aoEvento);
  evento.current = aoEvento;
  const fonteAoVivo = useRef(aoVivo);
  fonteAoVivo.current = aoVivo;
  // status que mudaram depois de a página abrir (venda/reserva feita agora por outra pessoa)
  const [statusAoVivo, setStatusAoVivo] = useState<Record<string, StatusUnidade>>({});
  const statusAoVivoRef = useRef(statusAoVivo);
  statusAoVivoRef.current = statusAoVivo;
  const [estadoAoVivo, setEstadoAoVivo] = useState<'desligado' | 'conectando' | 'conectado'>('desligado');
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [telemetria, setTelemetria] = useState<EstadoViewer | null>(null);
  const [filtro, setFiltro] = useState<Filtro>(filtroVazio);
  const [favoritos, setFavoritos] = useState<Set<string>>(() => new Set());
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [andarCorte, setAndarCorte] = useState('');
  const [comCorte, setComCorte] = useState<number[]>([]);
  const [dataSol, setDataSol] = useState(hoje);
  const [horaSol, setHoraSol] = useState(10);
  const [clima, setClima] = useState<Clima>('limpo');
  const [entorno, setEntorno] = useState<EstadoEntorno>({ tipo: 'carregando' });
  const [interiorAberto, setInteriorAberto] = useState<{ id: string; nome: string } | null>(null);

  // depois da hidratação: o servidor não conhece o navegador de quem vê
  useEffect(() => setFavoritos(lerFavoritos(predioId)), [predioId]);

  // um viewer por modelo
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const c = inicial.current;
    setEstado('carregando');
    const v = criarViewer(el, { unidades: c.unidades, modeloUrl: c.modeloUrl, rotacaoGraus: c.rotacaoGraus, lat: c.lat ?? undefined, lon: c.lon ?? undefined, decodificadores: DECODIFICADORES,
      ...(c.qualidadeFixa !== null ? { qualidadeInicial: c.qualidadeFixa, qualidadeFixa: true } : {}),
    });
    viewer.current = v;
    let vivo = true;
    v.aoSelecionar((id) => setSelecionada(id));
    // telemetria: uma vez por visita, ao sair da página (ou trocar de página dentro do site)
    let enviado = false;
    const enviarTelemetria = () => {
      const m = v.metricas();
      if (!c.comTelemetria || enviado || (m.cargaMs === null && m.erros === 0)) return;
      enviado = true;
      const corpo = JSON.stringify({ predioId: c.predioId, ...m, celular: window.matchMedia('(pointer: coarse)').matches });
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
  const passam = useMemo(() => filtrar(unidadesAtuais, filtro, favoritos), [unidadesAtuais, filtro, favoritos]);
  const ativo = filtroAtivo(filtro);
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

  // estande: o próximo visitante começa do zero (sem filtro, unidade, corte ou interior do anterior)
  const reinicio = estande?.reinicio ?? 0;
  useEffect(() => {
    if (!reinicio) return;
    setFiltro(filtroVazio);
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
  const lista = unidadesAtuais.filter((u) => passam.has(u.id));
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
    setSelecionada(id);
    viewer.current?.voarPara(id);
  };
  const aoAcaoIA = (a: AcaoAssistente) => {
    if (a.tipo === 'contato') return aoPedirContato?.(a.motivo, a.unidade);
    setDestaqueIA(a.unidades.length ? new Set(a.unidades) : null);
    if (a.focar) voar(a.focar);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
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
        {interiorAberto && <InteriorSplat arquivo={interiorAberto} linkDoArquivo={linkDoArquivo} aoFechar={() => setInteriorAberto(null)} />}
        {modo === 'primeira-pessoa' && <Joystick aoMover={(e) => viewer.current?.definirEntrada(e)} />}
      </div>

      {/* estande: a coluna rola sozinha; o 3D e o cabeçalho (com o QR) ficam sempre na tela */}
      <div ref={coluna} className={`grid gap-4 ${estande ? 'lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1' : ''}`}>
        {unidade && (
          <Cartao titulo={`Unidade ${unidade.codigo}`}>
            <div data-testid="unidade-selecionada" className="grid gap-3 text-sm">
              <span className={`w-fit rounded px-2 py-0.5 text-xs font-semibold ${COR_STATUS[unidade.status]}`}>{ROTULO_STATUS[unidade.status]}</span>
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
              <div className="flex flex-wrap gap-2">
                <Botao type="button" variante="secundario" onClick={() => favoritar(unidade.id)} aria-pressed={favoritos.has(unidade.id)}>
                  {favoritos.has(unidade.id) ? '★ Favorita' : '☆ Favoritar'}
                </Botao>
                <Botao type="button" variante="secundario" onClick={() => voar(unidade.id)}>
                  Ir até ela
                </Botao>
              </div>
            </div>
          </Cartao>
        )}

        {assistenteUrl && (
          <Cartao titulo="Pergunte ao assistente">
            <Assistente url={assistenteUrl} aoAcao={aoAcaoIA} />
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
            <label className="flex min-h-10 items-center gap-2">
              <input type="checkbox" checked={filtro.somenteFavoritos} onChange={(e) => setFiltro({ ...filtro, somenteFavoritos: e.target.checked })} />
              Só favoritas ({favoritos.size})
            </label>
            {ativo && (
              <Botao type="button" variante="secundario" onClick={() => setFiltro(filtroVazio())}>
                Limpar filtros
              </Botao>
            )}
          </div>
        </Cartao>

        <Cartao titulo="Unidades">
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
            <div className="grid grid-cols-2 gap-3">
              <Campo id="data-sol" rotulo="Dia do sol" type="date" value={dataSol} onChange={(e) => e.target.value && setDataSol(e.target.value)} />
              <label htmlFor="hora-sol" className="grid gap-1">
                <span className="font-medium">Hora: {horaLegivel(horaSol)}</span>
                <input id="hora-sol" type="range" min={6} max={19} step={0.25} value={horaSol} onChange={(e) => setHoraSol(Number(e.target.value))} />
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
            {!estande && (
              <Botao type="button" variante="secundario" disabled={estado !== 'pronto' || baixando} onClick={() => void baixarImagem()}>
                {baixando ? 'Gerando imagem…' : 'Baixar imagem (PNG)'}
              </Botao>
            )}
            {modo === 'orbita' ? (
              <Botao type="button" variante="secundario" disabled={estado !== 'pronto'} onClick={() => viewer.current?.definirModo('primeira-pessoa')}>
                Andar a pé (1ª pessoa)
              </Botao>
            ) : (
              <>
                <p className="text-suave">WASD ou setas para andar, arraste para olhar. No celular, use o controle no canto da tela.</p>
                <Botao type="button" variante="secundario" onClick={() => viewer.current?.definirModo('orbita')}>
                  Voltar para a vista de cima
                </Botao>
              </>
            )}
          </div>
        </Cartao>
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
