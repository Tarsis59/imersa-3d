'use client';
import { useEffect, useRef, useState, useTransition, type MouseEvent as EventoMouse } from 'react';
import Link from 'next/link';
import { criarViewer, exportarGlb, type AberturaPx, type EdicaoPlanta, type SegmentoPx, type Viewer } from '@imersa/viewer';
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { DECODIFICADORES } from '@/lib/decodificadores';
import { numeroBr } from '@/lib/configurador';
import type { Envio } from '../../projetos/[id]/actions-arquivos';

type Ferramenta = 'selecionar' | 'parede' | 'porta' | 'janela' | 'medida';
type Selecionado = { tipo: 'parede' | 'abertura'; indice: number } | null;
type Rascunho = Omit<EdicaoPlanta, 'escalaMPorPx'> & { escalaMPorPx: number | null };

const COR_ABERTURA = { porta: '#dc2626', janela: '#2563eb', passagem: '#16a34a' } as const;
const ROTULO_FERRAMENTA: Record<Ferramenta, string> = { selecionar: 'Selecionar', parede: 'Desenhar parede', porta: 'Pôr porta', janela: 'Pôr janela', medida: 'Marcar medida (escala)' };
const LARGURA_PADRAO_M = { porta: 0.9, janela: 1.2 } as const;

/** Ponto do segmento mais perto de p e a posição ao longo dele (0 a 1). */
function projetar(s: SegmentoPx, x: number, y: number) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((x - s.x1) * dx + (y - s.y1) * dy) / L2));
  const px = s.x1 + t * dx;
  const py = s.y1 + t * dy;
  return { t, px, py, distancia: Math.hypot(x - px, y - py) };
}

export function EditorPlanta({
  nome,
  imagemUrl,
  largura,
  altura,
  espessuraPx,
  inicial,
  predios,
  acoes,
}: {
  nome: string;
  imagemUrl: string;
  largura: number;
  altura: number;
  espessuraPx: number;
  inicial: Rascunho;
  predios: Array<{ id: string; nome: string }>;
  acoes: {
    salvar: (e: EdicaoPlanta) => Promise<{ erro?: string }>;
    usarModelo: (arquivoId: string, predioId: string | null) => Promise<{ erro?: string }>;
    prepararEnvio: (nome: string, tipo: 'modelo_3d', tamanho: number) => Promise<Envio>;
    concluirEnvio: (arquivoId: string) => Promise<{ status?: string; erro?: string }>;
  };
}) {
  const [r, setR] = useState<Rascunho>(inicial);
  const [ferramenta, setFerramenta] = useState<Ferramenta>('selecionar');
  const [selecionado, setSelecionado] = useState<Selecionado>(null);
  const [inicioParede, setInicioParede] = useState<{ x: number; y: number } | null>(null);
  const [medida, setMedida] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } | null } | null>(null);
  const [metrosMedida, setMetrosMedida] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [predioId, setPredioId] = useState(predios[0]?.id ?? '');
  const [previa, setPrevia] = useState<string | null>(null);
  const [gerado, setGerado] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const svg = useRef<SVGSVGElement>(null);
  const tela3d = useRef<HTMLCanvasElement>(null);

  const espessuraPadrao = r.paredes.length ? r.paredes.map((p) => p.espessura).sort((a, b) => a - b)[Math.floor(r.paredes.length / 2)]! : espessuraPx;

  function pontoSvg(e: EventoMouse) {
    const el = svg.current!;
    const m = el.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  }

  function clicar(e: EventoMouse) {
    const p = pontoSvg(e);
    if (ferramenta === 'parede') {
      if (!inicioParede) return setInicioParede(p);
      // quase reta vira reta (horizontal/vertical): plantas são, em geral, ortogonais
      let { x, y } = p;
      if (Math.abs(y - inicioParede.y) < Math.abs(x - inicioParede.x) * 0.18) y = inicioParede.y;
      else if (Math.abs(x - inicioParede.x) < Math.abs(y - inicioParede.y) * 0.18) x = inicioParede.x;
      setR((v) => ({ ...v, paredes: [...v.paredes, { x1: inicioParede.x, y1: inicioParede.y, x2: x, y2: y, espessura: espessuraPadrao }] }));
      setInicioParede(null);
      return;
    }
    if (ferramenta === 'porta' || ferramenta === 'janela') {
      const perto = r.paredes.map((s, i) => ({ i, ...projetar(s, p.x, p.y) })).sort((a, b) => a.distancia - b.distancia)[0];
      if (!perto || perto.distancia > Math.max(12, r.paredes[perto.i]!.espessura * 1.5)) return setAviso({ tipo: 'erro', texto: 'Clique em cima de uma parede para pôr a porta ou a janela.' });
      const s = r.paredes[perto.i]!;
      const comp = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      const meiaPx = (r.escalaMPorPx ? LARGURA_PADRAO_M[ferramenta] / r.escalaMPorPx : s.espessura * 4) / 2;
      const ux = (s.x2 - s.x1) / comp;
      const uy = (s.y2 - s.y1) / comp;
      const nova: AberturaPx = { tipo: ferramenta, x1: perto.px - ux * meiaPx, y1: perto.py - uy * meiaPx, x2: perto.px + ux * meiaPx, y2: perto.py + uy * meiaPx, espessura: s.espessura };
      setR((v) => ({ ...v, aberturas: [...v.aberturas, nova] }));
      setAviso(null);
      return;
    }
    if (ferramenta === 'medida') {
      if (!medida || medida.b) return setMedida({ a: p, b: null });
      setMedida({ ...medida, b: p });
      return;
    }
    setSelecionado(null);
  }

  function aplicarMedida() {
    const m = numeroBr(metrosMedida);
    if (!medida?.b || m === null || !Number.isFinite(m) || m <= 0) return setAviso({ tipo: 'erro', texto: 'Marque os dois pontos e digite a medida real em metros (ex.: 12 ou 3,45).' });
    const px = Math.hypot(medida.b.x - medida.a.x, medida.b.y - medida.a.y);
    if (px < 5) return setAviso({ tipo: 'erro', texto: 'Os pontos estão muito perto: marque uma medida maior.' });
    setR((v) => ({ ...v, escalaMPorPx: m / px }));
    setMedida(null);
    setMetrosMedida('');
    setFerramenta('selecionar');
    setAviso({ tipo: 'sucesso', texto: `Escala definida: 1 m = ${(px / m).toFixed(1)} px da planta.` });
  }

  function apagar() {
    if (!selecionado) return;
    setR((v) =>
      selecionado.tipo === 'parede' ? { ...v, paredes: v.paredes.filter((_, i) => i !== selecionado.indice) } : { ...v, aberturas: v.aberturas.filter((_, i) => i !== selecionado.indice) },
    );
    setSelecionado(null);
  }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selecionado && !(e.target instanceof HTMLInputElement)) apagar();
      if (e.key === 'Escape') {
        setInicioParede(null);
        setMedida(null);
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  const pronta = (): EdicaoPlanta | null => {
    if (!r.escalaMPorPx) {
      setAviso({ tipo: 'erro', texto: 'Defina a escala primeiro: “Marcar medida”, clique nas duas pontas de uma cota e digite os metros.' });
      return null;
    }
    if (!r.paredes.length) {
      setAviso({ tipo: 'erro', texto: 'A planta não tem paredes.' });
      return null;
    }
    return { ...r, escalaMPorPx: r.escalaMPorPx };
  };

  // prévia 3D: o mesmo GLB que vai ser gerado, aberto no visualizador
  useEffect(() => {
    if (!previa || !tela3d.current) return;
    let v: Viewer | null = criarViewer(tela3d.current, { unidades: [], modeloUrl: previa, decodificadores: DECODIFICADORES });
    return () => {
      v?.destruir();
      v = null;
      URL.revokeObjectURL(previa);
    };
  }, [previa]);

  async function verEm3d() {
    const e = pronta();
    if (!e) return;
    const glb = await exportarGlb(e);
    setPrevia(URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' })));
  }

  function salvar() {
    const e = pronta();
    if (!e) return;
    iniciar(async () => {
      const x = await acoes.salvar(e);
      setAviso(x.erro ? { tipo: 'erro', texto: x.erro } : { tipo: 'sucesso', texto: 'Planta salva.' });
    });
  }

  function gerar() {
    const e = pronta();
    if (!e) return;
    iniciar(async () => {
      try {
        const salvo = await acoes.salvar(e);
        if (salvo.erro) throw new Error(salvo.erro);
        const glb = await exportarGlb(e);
        const preparo = await acoes.prepararEnvio(`${nome.replace(/\.[^.]+$/, '')}-3d.glb`, 'modelo_3d', glb.byteLength);
        if (!preparo.ok) throw new Error(preparo.erro);
        const envio = await fetch(preparo.url, { method: preparo.metodo, headers: preparo.cabecalhos, body: glb });
        if (!envio.ok) throw new Error(`O armazenamento recusou o envio (${envio.status}).`);
        const fim = await acoes.concluirEnvio(preparo.id);
        if (fim.status !== 'pronto') throw new Error(fim.erro ?? 'O 3D foi recusado na verificação.');
        const uso = await acoes.usarModelo(preparo.id, predioId || null);
        if (uso.erro) throw new Error(uso.erro);
        setGerado(predioId || null);
        setAviso({ tipo: 'sucesso', texto: predioId ? `3D gerado e ligado ao prédio ${predios.find((p) => p.id === predioId)?.nome ?? ''}.` : '3D gerado e guardado em Arquivos.' });
      } catch (x) {
        setAviso({ tipo: 'erro', texto: (x as Error).message });
      }
    });
  }

  const cor = (i: number, tipo: 'parede' | 'abertura') => (selecionado?.tipo === tipo && selecionado.indice === i ? '#9333ea' : undefined);
  const larguraTraco = Math.max(2, espessuraPadrao * 0.35);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Ferramentas da planta">
        {(Object.keys(ROTULO_FERRAMENTA) as Ferramenta[]).map((f) => (
          <Botao
            key={f}
            type="button"
            variante={ferramenta === f ? 'primario' : 'secundario'}
            aria-pressed={ferramenta === f}
            onClick={() => {
              setFerramenta(f);
              setInicioParede(null);
              setMedida(null);
            }}
          >
            {ROTULO_FERRAMENTA[f]}
          </Botao>
        ))}
        <Botao type="button" variante="perigo" disabled={!selecionado} onClick={apagar}>
          Apagar selecionado
        </Botao>
      </div>
      {ferramenta === 'medida' && (
        <div className="flex flex-wrap items-end gap-3">
          <p className="text-sm">{!medida ? 'Clique no início de uma medida conhecida (uma cota).' : !medida.b ? 'Agora clique no fim.' : 'Digite quanto mede, em metros:'}</p>
          {medida?.b && (
            <>
              <Campo id="medida-metros" rotulo="Comprimento real (m)" inputMode="decimal" value={metrosMedida} onChange={(e) => setMetrosMedida(e.target.value)} />
              <Botao type="button" onClick={aplicarMedida}>
                Aplicar escala
              </Botao>
            </>
          )}
        </div>
      )}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <div className="overflow-auto rounded-2xl border border-borda bg-white">
        <svg
          ref={svg}
          viewBox={`0 0 ${largura} ${altura}`}
          className={`block w-full ${ferramenta === 'selecionar' ? '' : 'cursor-crosshair'}`}
          onClick={clicar}
          data-testid="editor-planta"
          data-paredes={r.paredes.length}
          data-aberturas={r.aberturas.length}
          data-escala={r.escalaMPorPx ?? ''}
          role="img"
          aria-label={`Planta ${nome} com ${r.paredes.length} paredes e ${r.aberturas.length} aberturas`}
        >
          <image href={imagemUrl} x={0} y={0} width={largura} height={altura} opacity={0.55} />
          {r.paredes.map((s, i) => (
            <line
              key={`p${i}`}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={cor(i, 'parede') ?? '#f97316'}
              strokeWidth={Math.max(larguraTraco, s.espessura * 0.6)}
              strokeLinecap="square"
              opacity={0.85}
              onClick={(e) => {
                if (ferramenta !== 'selecionar') return;
                e.stopPropagation();
                setSelecionado({ tipo: 'parede', indice: i });
              }}
            />
          ))}
          {r.aberturas.map((a, i) => (
            <line
              key={`a${i}`}
              x1={a.x1}
              y1={a.y1}
              x2={a.x2}
              y2={a.y2}
              stroke={cor(i, 'abertura') ?? COR_ABERTURA[a.tipo]}
              strokeWidth={Math.max(larguraTraco, a.espessura * 0.8)}
              data-tipo={a.tipo}
              onClick={(e) => {
                if (ferramenta !== 'selecionar') return;
                e.stopPropagation();
                setSelecionado({ tipo: 'abertura', indice: i });
              }}
            />
          ))}
          {inicioParede && <circle cx={inicioParede.x} cy={inicioParede.y} r={larguraTraco * 1.5} fill="#f97316" />}
          {medida && (
            <>
              <circle cx={medida.a.x} cy={medida.a.y} r={larguraTraco * 1.5} fill="#9333ea" />
              {medida.b && <line x1={medida.a.x} y1={medida.a.y} x2={medida.b.x} y2={medida.b.y} stroke="#9333ea" strokeWidth={larguraTraco} strokeDasharray="6 4" />}
            </>
          )}
        </svg>
      </div>

      <Cartao titulo="Alturas e escala">
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo id="altura-parede" rotulo="Pé-direito (m)" inputMode="decimal" defaultValue={String(r.alturaParedeM).replace('.', ',')} onBlur={(e) => setR((v) => ({ ...v, alturaParedeM: numeroBr(e.target.value) ?? v.alturaParedeM }))} />
          <Campo id="altura-porta" rotulo="Altura da porta (m)" inputMode="decimal" defaultValue={String(r.alturaPortaM).replace('.', ',')} onBlur={(e) => setR((v) => ({ ...v, alturaPortaM: numeroBr(e.target.value) ?? v.alturaPortaM }))} />
          <Campo id="peitoril" rotulo="Peitoril da janela (m)" inputMode="decimal" defaultValue={String(r.peitorilM).replace('.', ',')} onBlur={(e) => setR((v) => ({ ...v, peitorilM: numeroBr(e.target.value) ?? v.peitorilM }))} />
          <Campo id="altura-janela" rotulo="Altura da janela (m)" inputMode="decimal" defaultValue={String(r.alturaJanelaM).replace('.', ',')} onBlur={(e) => setR((v) => ({ ...v, alturaJanelaM: numeroBr(e.target.value) ?? v.alturaJanelaM }))} />
        </div>
        <p className="mt-3 text-sm" data-testid="escala-planta">
          {r.escalaMPorPx ? `Escala: 1 m = ${(1 / r.escalaMPorPx).toFixed(1)} px da planta (largura total ≈ ${(largura * r.escalaMPorPx).toFixed(1)} m).` : 'Escala ainda não definida.'}
        </p>
      </Cartao>

      <div className="flex flex-wrap items-end gap-3">
        <Botao type="button" variante="secundario" onClick={salvar} disabled={ocupado}>
          Salvar planta
        </Botao>
        <Botao type="button" variante="secundario" onClick={() => void verEm3d()} disabled={ocupado}>
          Ver em 3D
        </Botao>
        {predios.length > 0 && (
          <Selecao id="predio-destino" rotulo="Usar como modelo do prédio" value={predioId} onChange={(e) => setPredioId(e.target.value)}>
            {predios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
            <option value="">Só guardar em Arquivos</option>
          </Selecao>
        )}
        <Botao type="button" onClick={gerar} disabled={ocupado}>
          {ocupado ? 'Gerando…' : 'Gerar 3D'}
        </Botao>
      </div>
      {gerado && (
        <div className="flex flex-wrap gap-4 text-sm font-semibold">
          <Link href={`/painel/predios/${gerado}/vitrine`} className="underline">
            Abrir Vitrine 3D
          </Link>
          <Link href={`/painel/predios/${gerado}/configurador`} className="underline">
            Abrir Configurador
          </Link>
        </div>
      )}
      {previa && (
        <div className="aspect-[16/10] w-full overflow-hidden rounded-2xl border border-borda" data-testid="previa-planta-3d">
          <canvas ref={tela3d} className="h-full w-full" aria-label="Prévia 3D da planta" />
        </div>
      )}
      <p className="text-xs text-suave">Delete apaga o item selecionado; Esc cancela o desenho em andamento.</p>
    </div>
  );
}
