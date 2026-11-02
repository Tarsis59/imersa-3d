'use client';
import { useEffect, useRef, useState } from 'react';
import type { UnidadeViewer } from '@imersa/viewer';
import { Vitrine, type EventoVitrine } from '@/app/painel/predios/[id]/vitrine/vitrine';
import type { ResultadoEntorno } from '@/app/painel/predios/[id]/vitrine/actions';
import { conferir, inicial, tocar, type EstadoEstande } from '@/lib/estande';
import type { Portal } from '@/lib/tipos';
import type { DadosSinal, enviarSinal } from './actions';

type EventoApi = { tipo: 'abriu' | 'unidade' | 'favorito' | 'interior' | 'tempo' | 'tour_lazer'; unidadeId?: string; duracaoS?: number };
/** O PC do estande fica dias ligado: recarrega (memória limpa, versão nova do site) quando está só apresentando. */
const RECARGA_H = 12;

/** Quadros por segundo da página (o 3D desenha no mesmo ritmo): vai no sinal de vida para o painel. */
function useFps() {
  const fps = useRef(0);
  useEffect(() => {
    let quadros = 0;
    let inicio = performance.now();
    let id = requestAnimationFrame(function passo(agora) {
      quadros++;
      if (agora - inicio >= 5000) {
        fps.current = Math.round((quadros * 1000) / (agora - inicio));
        quadros = 0;
        inicio = agora;
      }
      id = requestAnimationFrame(passo);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return fps;
}

/** Estande offline: o PC guarda página, código e modelo 3D (ver public/sw-estande.js) e abre mesmo sem internet. */
function useEstandeOffline() {
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let vivo = true;
    navigator.serviceWorker
      .register('/sw-estande.js', { scope: '/estande/' })
      .then(() => navigator.serviceWorker.ready)
      .then(() => vivo && setPronto(true))
      .catch(() => undefined); // sem service worker (navegador antigo, modo privado): funciona só online, como antes
    return () => {
      vivo = false;
    };
  }, []);
  return pronto;
}

type TravaTela = { release: () => Promise<void> };
/** Tela sempre acesa (Wake Lock): sem isso o PC apaga a TV no meio do estande. */
function useTelaAcesa() {
  useEffect(() => {
    let trava: TravaTela | null = null;
    const pedir = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        trava = (await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<TravaTela> } }).wakeLock?.request('screen')) ?? null;
      } catch {
        trava = null; // sem permissão ou sem suporte: segue normal
      }
    };
    void pedir();
    document.addEventListener('visibilitychange', pedir);
    return () => {
      document.removeEventListener('visibilitychange', pedir);
      void trava?.release().catch(() => undefined);
    };
  }, []);
}

/**
 * Cada visitante que mexe na tela é uma visita (sessão própria): conta nos números do empreendimento, com o tempo
 * que ficou e as unidades que viu.
 */
function useVisitas(token: string) {
  const fila = useRef<EventoApi[]>([]);
  const sessao = useRef<{ id: string; inicio: number } | null>(null);
  const url = `/api/publico/${token}/eventos`;
  const enviar = useRef((id: string) => {
    const eventos = fila.current.splice(0, 50);
    if (!eventos.length) return;
    void fetch(url, { method: 'POST', body: JSON.stringify({ sessao: id, eventos }), headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => undefined);
  });
  useEffect(() => {
    const t = setInterval(() => {
      if (sessao.current) enviar.current(sessao.current.id);
    }, 15_000);
    return () => clearInterval(t);
  }, []);
  return useRef({
    comecar() {
      if (sessao.current) return;
      sessao.current = { id: crypto.randomUUID(), inicio: Date.now() };
      fila.current.push({ tipo: 'abriu' });
      enviar.current(sessao.current.id);
    },
    terminar() {
      const s = sessao.current;
      if (!s) return;
      fila.current.push({ tipo: 'tempo', duracaoS: Math.min(86_400, Math.round((Date.now() - s.inicio) / 1000)) });
      enviar.current(s.id);
      sessao.current = null;
    },
    registrar(e: EventoVitrine) {
      if (sessao.current) fila.current.push(e);
    },
  }).current;
}

function Relogio() {
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const t = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-2xl font-semibold tabular-nums">{agora?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) ?? ''}</span>;
}

/**
 * Tela do PC do estande: a Vitrine em tela cheia, apresentação automática quando ninguém mexe, QR code para o
 * visitante levar no celular, sinal de vida para o painel e tela sempre acesa.
 */
export function TelaEstande({
  token,
  portal,
  nome,
  qr,
  ociosoS,
  sinalS,
  carregarEntorno,
  linkDoArquivo,
  sinal,
}: {
  token: string;
  portal: Portal;
  nome: string;
  /** QR code do link do visitante (imagem PNG em data URL, gerada no servidor). */
  qr: string;
  ociosoS: number;
  /** Segundos entre os sinais de vida. */
  sinalS: number;
  carregarEntorno: () => Promise<ResultadoEntorno>;
  linkDoArquivo: (arquivoId: string) => Promise<string | null>;
  sinal: (d: DadosSinal) => ReturnType<typeof enviarSinal>;
}) {
  const [estado, setEstado] = useState<EstadoEstande>(() => inicial(Date.now()));
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const [desativado, setDesativado] = useState(false);
  const [semInternet, setSemInternet] = useState(false);
  const [telaCheia, setTelaCheia] = useState(true);
  const fps = useFps();
  const visitas = useVisitas(token);
  useTelaAcesa();
  const offline = useEstandeOffline();

  // toque, clique, tecla ou roda: alguém está usando
  useEffect(() => {
    const aoUsar = () => {
      if (estadoRef.current.apresentando) visitas.comecar();
      setEstado((e) => tocar(e, Date.now()));
    };
    const opcoes = { capture: true, passive: true } as const;
    const tipos = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const t of tipos) window.addEventListener(t, aoUsar, opcoes);
    const relogio = setInterval(() => {
      const atual = estadoRef.current;
      const novo = conferir(atual, Date.now(), ociosoS);
      if (novo === atual) return;
      visitas.terminar();
      setEstado(novo);
    }, 1000);
    return () => {
      for (const t of tipos) window.removeEventListener(t, aoUsar, opcoes);
      clearInterval(relogio);
    };
  }, [ociosoS, visitas]);

  // sinal de vida: o painel vê online/offline e pode pedir para recarregar
  useEffect(() => {
    const aberto = Date.now();
    let falhas = 0;
    const enviar = async () => {
      const r = await sinal({ fps: fps.current, largura: window.screen.width, altura: window.screen.height, apresentando: estadoRef.current.apresentando }).catch(
        () => ({ status: 'erro' }) as const,
      );
      if (r.status === 'desativado') return setDesativado(true);
      if (r.status === 'ok') {
        falhas = 0;
        if (r.recarregar) return window.location.reload();
      } else if (++falhas >= 3 && navigator.onLine) {
        // com internet e o site sem responder a este estande: saiu versão nova do site; recarregar resolve
        return window.location.reload();
      }
      if (estadoRef.current.apresentando && Date.now() - aberto > RECARGA_H * 3_600_000) window.location.reload();
    };
    const primeiro = setTimeout(() => void enviar(), 3000);
    const t = setInterval(() => void enviar(), sinalS * 1000);
    return () => {
      clearTimeout(primeiro);
      clearInterval(t);
    };
  }, [sinal, fps, sinalS]);

  useEffect(() => {
    const rede = () => setSemInternet(!navigator.onLine);
    const tela = () => setTelaCheia(Boolean(document.fullscreenElement) || window.innerHeight >= window.screen.height - 2);
    // estande: sem menu do botão direito (nem do toque longo)
    const semMenu = (e: Event) => e.preventDefault();
    rede();
    tela();
    window.addEventListener('online', rede);
    window.addEventListener('offline', rede);
    window.addEventListener('resize', tela);
    document.addEventListener('fullscreenchange', tela);
    document.addEventListener('contextmenu', semMenu);
    return () => {
      window.removeEventListener('online', rede);
      window.removeEventListener('offline', rede);
      window.removeEventListener('resize', tela);
      document.removeEventListener('fullscreenchange', tela);
      document.removeEventListener('contextmenu', semMenu);
    };
  }, []);

  if (desativado) {
    return (
      <main data-testid="estande-desativado" className="grid min-h-dvh place-items-center bg-fundo p-8 text-center">
        <div className="grid gap-3">
          <h1 className="text-3xl font-bold">Estande desativado</h1>
          <p className="text-lg text-suave">Fale com a equipe de vendas.</p>
        </div>
      </main>
    );
  }

  const unidades: UnidadeViewer[] = portal.unidades.map((u) => ({ id: u.id, codigo: u.codigo, andar: u.andar, status: u.status, areaM2: u.areaM2, quartos: u.quartos, preco: u.preco, meshNodeId: u.meshNodeId }));
  return (
    <div data-testid="estande" data-apresentacao={estado.apresentando ? 'ligada' : 'desligada'} data-reinicio={estado.reinicio} data-offline={offline ? 'pronto' : ''} className="min-h-dvh select-none overscroll-none bg-fundo">
      <header className="flex h-24 items-center justify-between gap-6 px-6">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm text-suave">
            {portal.empresa.nome} · {nome}
          </span>
          <h1 className="truncate text-3xl font-bold">
            {portal.projeto.nome} · {portal.predio.nome}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          {semInternet && (
            <span role="status" className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
              Sem internet: os dados podem estar desatualizados
            </span>
          )}
          {!telaCheia && (
            <button
              type="button"
              onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
              className="rounded-lg border border-borda bg-superficie px-4 py-2 text-sm font-semibold hover:bg-fundo"
            >
              Tela cheia
            </button>
          )}
          <Relogio />
          <div className="flex items-center gap-3">
            <span className="hidden max-w-36 text-right text-sm leading-tight text-suave sm:block">Leve no celular: aponte a câmera</span>
            {/* imagem gerada no servidor (data URL): não passa pelo otimizador de imagens */}
            <img data-testid="qr-estande" src={qr} alt="QR code: abre este empreendimento no celular" className="size-20 rounded-lg bg-white p-1" />
          </div>
        </div>
      </header>
      <main className="px-4 pb-4">
        <Vitrine
          predioId={portal.predio.id}
          projetoId={portal.projeto.id}
          predioNome={portal.predio.nome}
          empresa={portal.empresa.nome}
          chaveModelo={portal.modeloUrl ? 'modelo' : 'volumes'}
          modeloUrl={portal.modeloUrl}
          unidades={unidades}
          andares={portal.andares}
          rotacaoGraus={portal.projeto.rotacaoGraus}
          lat={portal.projeto.lat}
          lon={portal.projeto.lon}
          interiores={portal.interiores}
          lazer={portal.lazer}
          giroRenderizado={portal.giro}
          assistenteUrl={portal.assistenteUrl}
          carregarEntorno={carregarEntorno}
          linkDoArquivo={linkDoArquivo}
          telemetria={false}
          aoEvento={(e) => visitas.registrar(e)}
          aoVivo={async () => portal.aoVivoUrl}
          estande={{ apresentando: estado.apresentando, reinicio: estado.reinicio }}
        />
      </main>
    </div>
  );
}
