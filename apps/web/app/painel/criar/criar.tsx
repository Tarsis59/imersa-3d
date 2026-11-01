'use client';
import { zipSync } from 'fflate';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { classificar, coresDaImagem, extensao, lerExif, papeisPossiveis, pareceDesenho, ROTULO_PAPEL, TIPO_DO_PAPEL, type PapelArquivo } from '@/lib/classificar';
import { CATEGORIAS_LAZER, ROTULO_LAZER, tamanhoLegivel, type CategoriaLazer, type Descricao, type PlanoCriacao, type TipologiaLida } from '@/lib/tipos';
import { lerXlsx, tabelaParaCsv } from '@/lib/xlsx';
import { concluirEnvio, prepararEnvio } from '../projetos/[id]/actions-arquivos';
import { enviarComProgresso } from '../projetos/[id]/secoes';
import { criarEmpreendimento, iniciarMontagem, interpretar, recalcularPlano, type ArquivoMontagem } from './actions';

const MAX_ARQUIVOS = 200;
/** Com pelo menos isso de fotos do imóvel, dá para tentar o 3D real (splat); menos que isso o validador recusa. */
const MIN_FOTOS_SPLAT = 20;
const ENVIOS_JUNTOS = 3;
const TENTATIVAS = 3;
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

type EstadoItem = 'na_lista' | 'enviando' | 'enviado' | 'falhou';
interface Item {
  chave: string;
  arquivo: File;
  papel: Exclude<PapelArquivo, 'planilha' | 'texto'>;
  possiveis: PapelArquivo[];
  gps: { lat: number; lon: number } | null;
  /** Bússola da foto (graus a partir do norte), para o quadro no 3D olhar para o lado certo. */
  rumo: number | null;
  estado: EstadoItem;
  enviado: number;
  id?: string;
  erro?: string;
}

const DESCRICAO_VAZIA: Descricao = {
  nome: null,
  andares: null,
  unidadesPorAndar: null,
  totalUnidades: null,
  subsolos: null,
  torres: null,
  tipologias: [],
  vagas: null,
  lazer: [],
  endereco: null,
  bairro: null,
  cidade: null,
  uf: null,
  cep: null,
  precoAPartirDe: null,
  avisos: [],
};

/** Mesmo nome que a leitura do texto dá (ver apps/api/src/criacao/texto.ts). */
function nomeTipologia(q: number, s: number): string {
  if (q === 0) return 'Studio';
  const base = `${q} quarto${q > 1 ? 's' : ''}`;
  if (!s) return base;
  return `${base} (${s === q ? (s === 1 ? 'suíte' : 'todos suítes') : `${s} suíte${s > 1 ? 's' : ''}`})`;
}

async function lerCoresDaImagem(arquivo: File): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(arquivo, { resizeWidth: 64, resizeHeight: 64 });
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    if (!c) return false;
    c.drawImage(bmp, 0, 0);
    bmp.close();
    return pareceDesenho(coresDaImagem(c.getImageData(0, 0, 64, 64).data));
  } catch {
    return false;
  }
}

/** O que a montagem recebe de cada arquivo: o papel e, na foto com GPS, onde foi tirada e para onde olhava. */
const paraMontagem = (x: Item, id: string): ArquivoMontagem => ({ id, papel: x.papel, ...(x.gps ? { lat: x.gps.lat, lon: x.gps.lon, ...(x.rumo !== null ? { rumo: x.rumo } : {}) } : {}) });

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const numero = (v: string, min: number, max: number): number | null => {
  const n = Number(v);
  return v.trim() === '' || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, Math.round(n)));
};

export function Criar() {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [texto, setTexto] = useState('');
  const [itens, setItens] = useState<Item[]>([]);
  const [recusados, setRecusados] = useState<string[]>([]);
  const [planilha, setPlanilha] = useState<{ nome: string; csv: string; linhas: number } | null>(null);
  const [descricao, setDescricao] = useState<Descricao | null>(null);
  const [plano, setPlano] = useState<PlanoCriacao | null>(null);
  const [cep, setCep] = useState('');
  const [estilo, setEstilo] = useState<'moderno' | 'classico' | 'jovem'>('moderno');
  const [fotos3d, setFotos3d] = useState(true);
  const [fase, setFase] = useState<'editando' | 'lendo' | 'criando' | 'enviando' | 'iniciando'>('editando');
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [lendoArquivos, setLendoArquivos] = useState(0);
  const [criado, setCriado] = useState<{ projetoId: string; montagemId: string } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const recalculo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textoLido = useRef('');

  useEffect(() => () => void (recalculo.current && clearTimeout(recalculo.current)), []);

  async function adicionar(lista: File[]) {
    setErro(null);
    const fora: string[] = [];
    setLendoArquivos((n) => n + lista.length);
    const vistos = new Set(itens.map((x) => x.chave));
    let i = 0;
    for (const arquivo of lista) {
      i++;
      // larga 50 de uma vez sem travar a tela: devolve a vez ao navegador de tempos em tempos
      if (i % 5 === 0) await esperar(0);
      const possiveis = papeisPossiveis(arquivo.name);
      try {
        if (!possiveis.length) {
          fora.push(`${arquivo.name}: tipo não aceito`);
          continue;
        }
        if (possiveis[0] === 'planilha') {
          const bytes = new Uint8Array(await arquivo.arrayBuffer());
          const csv = extensao(arquivo.name) === '.xlsx' ? tabelaParaCsv(lerXlsx(bytes)) : new TextDecoder().decode(bytes);
          setPlanilha({ nome: arquivo.name, csv, linhas: Math.max(0, csv.trim().split(/\r?\n/).length - 1) });
          continue;
        }
        if (possiveis[0] === 'texto') {
          const t = (await arquivo.text()).slice(0, 4000);
          setTexto((v) => (v.trim() ? `${v.trim()}\n${t}` : t).slice(0, 4000));
          continue;
        }
        let gps = null;
        let rumo = null;
        let camera = false;
        const ext = extensao(arquivo.name);
        if (ext === '.jpg' || ext === '.jpeg') {
          const x = lerExif(new Uint8Array(await arquivo.slice(0, 256 * 1024).arrayBuffer()));
          gps = x.gps;
          rumo = x.rumo;
          camera = x.camera;
        }
        const ehImagem = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
        const desenho = ehImagem && !camera ? await lerCoresDaImagem(arquivo) : false;
        const papel = classificar(arquivo.name, { camera, desenho }) as Item['papel'];
        const item: Item = { chave: `${arquivo.name}:${arquivo.size}:${arquivo.lastModified}`, arquivo, papel, possiveis, gps, rumo, estado: 'na_lista', enviado: 0 };
        if (vistos.has(item.chave)) continue;
        if (vistos.size >= MAX_ARQUIVOS) {
          fora.push(`${arquivo.name}: limite de ${MAX_ARQUIVOS} arquivos`);
          continue;
        }
        vistos.add(item.chave);
        setItens((v) => (v.some((x) => x.chave === item.chave) ? v : [...v, item]));
      } catch (e) {
        fora.push(`${arquivo.name}: ${(e as Error).message}`);
      } finally {
        setLendoArquivos((n) => n - 1);
      }
    }
    if (fora.length) setRecusados((r) => [...r, ...fora]);
  }

  function soltar(e: DragEvent) {
    e.preventDefault();
    setArrastando(false);
    void adicionar([...e.dataTransfer.files]);
  }

  async function lerTexto(): Promise<Descricao | null> {
    if (!texto.trim()) return null;
    setFase('lendo');
    const r = await interpretar(texto);
    setFase('editando');
    if (r.erro || !r.descricao) {
      setErro(r.erro ?? 'Não deu para ler o texto.');
      return null;
    }
    textoLido.current = texto;
    setDescricao(r.descricao);
    setPlano(r.plano ?? null);
    if (!nome.trim() && r.descricao.nome) setNome(r.descricao.nome);
    if (!cep && r.descricao.cep) setCep(r.descricao.cep);
    return r.descricao;
  }

  function mudar(parcial: Partial<Descricao>) {
    if (!descricao) return;
    const nova = { ...descricao, ...parcial };
    setDescricao(nova);
    if (recalculo.current) clearTimeout(recalculo.current);
    recalculo.current = setTimeout(async () => {
      const r = await recalcularPlano(nova);
      if (!r.erro) setPlano(r.plano ?? null);
    }, 350);
  }

  function mudarTipologia(i: number, t: Partial<TipologiaLida>) {
    if (!descricao) return;
    const lista = descricao.tipologias.map((x, k) => ({ ...x, ...(k === i ? t : {}) }));
    // nomes únicos (a planilha liga a unidade à tipologia pelo nome)
    const usados = new Set<string>();
    for (const x of lista) {
      let n = nomeTipologia(x.quartos, Math.min(x.suites, x.quartos));
      for (let k = 2; usados.has(n); k++) n = `${nomeTipologia(x.quartos, Math.min(x.suites, x.quartos))} ${k}`;
      usados.add(n);
      x.nome = n;
      x.suites = Math.min(x.suites, x.quartos);
    }
    mudar({ tipologias: lista });
  }

  const atualizar = (chave: string, parcial: Partial<Item>) => setItens((v) => v.map((x) => (x.chave === chave ? { ...x, ...parcial } : x)));

  async function enviarItem(projetoId: string, item: Item): Promise<string | null> {
    for (let t = 1; t <= TENTATIVAS; t++) {
      try {
        atualizar(item.chave, { estado: 'enviando', enviado: 0, erro: undefined });
        const preparo = await prepararEnvio(projetoId, item.arquivo.name, TIPO_DO_PAPEL[item.papel], item.arquivo.size);
        if (!preparo.ok) throw new Error(preparo.erro);
        const status = await enviarComProgresso(preparo.url, preparo.cabecalhos, item.arquivo, (p) => atualizar(item.chave, { enviado: Math.round((p / 100) * item.arquivo.size) }));
        if (status >= 400) throw new Error(`O armazenamento recusou o envio (${status}).`);
        const fim = await concluirEnvio(projetoId, preparo.id);
        if (fim.status !== 'pronto') {
          // recusado na verificação (tipo, antivírus): tentar de novo não muda nada
          atualizar(item.chave, { estado: 'falhou', erro: fim.erro ?? 'Recusado na verificação.' });
          return null;
        }
        atualizar(item.chave, { estado: 'enviado', enviado: item.arquivo.size, id: preparo.id });
        return preparo.id;
      } catch (e) {
        if (t === TENTATIVAS) {
          atualizar(item.chave, { estado: 'falhou', erro: (e as Error).message });
          return null;
        }
        // internet caiu: espera e tenta de novo (1 s, 2 s...)
        await esperar(1000 * 2 ** (t - 1));
      }
    }
    return null;
  }

  async function enviarTodos(projetoId: string, lista: Item[]): Promise<ArquivoMontagem[]> {
    const fila = lista.filter((x) => x.estado !== 'enviado');
    const feitos = lista.filter((x) => x.estado === 'enviado' && x.id).map((x) => paraMontagem(x, x.id!));
    const trabalhar = async () => {
      for (let item = fila.shift(); item; item = fila.shift()) {
        const id = await enviarItem(projetoId, item);
        if (id) feitos.push(paraMontagem(item, id));
      }
    };
    await Promise.all(Array.from({ length: ENVIOS_JUNTOS }, trabalhar));
    return feitos;
  }

  const fotos = itens.filter((x) => x.papel === 'foto');
  const temCaptura = itens.some((x) => x.papel === 'captura');
  const gps = itens.flatMap((x) => (x.gps ? [x.gps] : []));

  async function criar(seguirSemOsQueFalharam = false) {
    setErro(null);
    let nomeFinal = nome.trim();
    let lista = itens;
    let alvo = criado;
    if (!alvo) {
      let desc = descricao;
      if (texto.trim() && (!desc || textoLido.current !== texto)) desc = await lerTexto();
      if (!desc) desc = DESCRICAO_VAZIA;
      nomeFinal ||= desc.nome ?? '';
      if (nomeFinal.length < 2) return setErro('Dê um nome ao empreendimento.');
      if (!planilha && !desc.andares && !desc.totalUnidades) return setErro('Diga quantos andares o prédio tem (no texto ou no campo abaixo), ou largue a planilha de unidades.');
      setFase('criando');
      const r = await criarEmpreendimento({ nome: nomeFinal, texto, descricao: desc, planilha: planilha?.csv ?? null, estilo, pistas: { gps: gps.slice(0, 500), cep: /^\d{5}-?\d{3}$/.test(cep.trim()) ? cep.trim() : null } });
      if (r.erro || !r.projetoId || !r.montagemId) {
        setFase('editando');
        return setErro(r.erro ?? 'Não deu para criar.');
      }
      alvo = { projetoId: r.projetoId, montagemId: r.montagemId };
      setCriado(alvo);
      // fotos soltas viram também o pacote do 3D real (a GPU grátis monta o splat)
      if (fotos3d && fotos.length >= MIN_FOTOS_SPLAT && !temCaptura) {
        const conteudo: Record<string, Uint8Array> = {};
        for (const f of fotos) conteudo[f.arquivo.name] = new Uint8Array(await f.arquivo.arrayBuffer());
        const zip = new File([zipSync(conteudo, { level: 0 }).slice()], 'fotos-do-imovel.zip', { type: 'application/zip' });
        const item: Item = { chave: 'zip-fotos', arquivo: zip, papel: 'captura', possiveis: ['captura'], gps: null, rumo: null, estado: 'na_lista', enviado: 0 };
        lista = [...itens, item];
        setItens(lista);
      }
    }
    setFase('enviando');
    const enviados = seguirSemOsQueFalharam ? lista.filter((x) => x.estado === 'enviado' && x.id).map((x) => paraMontagem(x, x.id!)) : await enviarTodos(alvo.projetoId, lista);
    const falhas = seguirSemOsQueFalharam ? 0 : lista.length - enviados.length;
    if (falhas > 0) {
      setFase('editando');
      return setErro(`${falhas} arquivo${falhas > 1 ? 's' : ''} não subi${falhas > 1 ? 'ram' : 'u'}. Tente de novo (a internet pode ter caído) ou siga sem ${falhas > 1 ? 'eles' : 'ele'}.`);
    }
    setFase('iniciando');
    const r = await iniciarMontagem(alvo.montagemId, { arquivos: enviados });
    if (r.erro) {
      setFase('editando');
      return setErro(r.erro);
    }
    router.push(`/painel/projetos/${alvo.projetoId}/montagem`);
  }

  const totalBytes = itens.reduce((a, x) => a + x.arquivo.size, 0);
  const enviadoBytes = itens.reduce((a, x) => a + x.enviado, 0);
  const ocupado = fase !== 'editando';
  const algumFalhou = itens.some((x) => x.estado === 'falhou');

  return (
    <div className="grid gap-6" data-testid="criar">
      <Cartao titulo="1. Larga tudo aqui">
        <div
          role="button"
          tabIndex={0}
          aria-label="Escolher ou arrastar arquivos"
          data-testid="soltar-arquivos"
          onClick={() => entrada.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), entrada.current?.click())}
          onDragOver={(e) => (e.preventDefault(), setArrastando(true))}
          onDragLeave={() => setArrastando(false)}
          onDrop={soltar}
          className={`grid cursor-pointer place-items-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${arrastando ? 'border-acento bg-acento/10' : 'border-borda hover:bg-fundo'}`}
        >
          <span className="text-base font-semibold">Arraste fotos, vídeos, plantas, projeto BIM, planilha e textos</span>
          <span className="text-sm text-suave">JPG, PNG, PDF, DXF, IFC, GLB, MP4, MOV, ZIP, CSV, XLSX, TXT · até {MAX_ARQUIVOS} arquivos de uma vez</span>
        </div>
        <input
          ref={entrada}
          type="file"
          multiple
          className="sr-only"
          data-testid="entrada-arquivos"
          onChange={(e) => {
            void adicionar([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        {lendoArquivos > 0 && <p className="mt-3 text-sm text-suave">Lendo {lendoArquivos} arquivo(s)...</p>}
        {recusados.length > 0 && (
          <div className="mt-3">
            <Aviso tipo="erro">
              Não aceitos: {recusados.join('; ')}.{' '}
              <button type="button" className="underline" onClick={() => setRecusados([])}>
                Fechar
              </button>
            </Aviso>
          </div>
        )}
        {planilha && (
          <p className="mt-3 text-sm" data-testid="planilha-lida">
            📊 <strong>{planilha.nome}</strong>: {planilha.linhas} unidades (as unidades vêm da planilha).{' '}
            <button type="button" className="underline" onClick={() => setPlanilha(null)} disabled={ocupado}>
              Tirar
            </button>
          </p>
        )}
        {itens.length > 0 && (
          <ul className="mt-4 grid gap-2" data-testid="lista-criacao">
            {itens.map((x) => (
              <li key={x.chave} className="grid gap-2 rounded-lg border border-borda p-3 sm:grid-cols-[1fr_auto] sm:items-center" data-testid="item-criacao" data-papel={x.papel} data-estado={x.estado}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={x.arquivo.name}>
                    {x.arquivo.name}
                  </p>
                  <p className="text-xs text-suave">
                    {tamanhoLegivel(x.arquivo.size)}
                    {x.gps ? ' · 📍 com GPS' : ''}
                    {x.estado === 'enviando' && ` · enviando ${Math.round((x.enviado / Math.max(1, x.arquivo.size)) * 100)}%`}
                    {x.estado === 'enviado' && ' · ✔ enviado'}
                    {x.estado === 'falhou' && <span className="text-perigo"> · {x.erro ?? 'falhou'}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`papel-${x.chave}`}>
                    O que é {x.arquivo.name}
                  </label>
                  <select
                    id={`papel-${x.chave}`}
                    className="rounded-lg border border-borda bg-superficie px-2 py-1 text-sm"
                    value={x.papel}
                    disabled={ocupado || x.estado === 'enviado' || x.possiveis.length < 2}
                    onChange={(e) => atualizar(x.chave, { papel: e.target.value as Item['papel'] })}
                  >
                    {x.possiveis.map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL[p]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-sm text-suave hover:bg-fundo disabled:opacity-40"
                    aria-label={`Tirar ${x.arquivo.name}`}
                    disabled={ocupado || x.estado === 'enviado'}
                    onClick={() => setItens((v) => v.filter((y) => y.chave !== x.chave))}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {fotos.length >= MIN_FOTOS_SPLAT && !temCaptura && (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={fotos3d} onChange={(e) => setFotos3d(e.target.checked)} disabled={ocupado} className="mt-1" />
            <span>
              Montar o <strong>3D real</strong> com estas {fotos.length} fotos (fila da GPU grátis: de minutos a 1 hora). O prédio desenhado fica pronto antes.
            </span>
          </label>
        )}
        {fotos.length > 0 && fotos.length < MIN_FOTOS_SPLAT && !temCaptura && (
          <p className="mt-3 text-xs text-suave">
            Para o 3D real do imóvel são precisas pelo menos {MIN_FOTOS_SPLAT} fotos (ou um vídeo andando pelos cômodos). Com {fotos.length}, elas ficam na galeria.
          </p>
        )}
      </Cartao>

      <Cartao titulo="2. Conte como é o empreendimento">
        <div className="grid gap-4">
          <Campo id="criar-nome" rotulo="Nome do empreendimento" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} disabled={ocupado} />
          <label htmlFor="criar-texto" className="grid gap-1 text-sm">
            <span className="font-medium">Descrição (do jeito que você fala)</span>
            <textarea
              id="criar-texto"
              rows={5}
              maxLength={4000}
              value={texto}
              disabled={ocupado}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Ex.: Residencial Aurora, 12 andares, 4 apartamentos por andar, 2 e 3 quartos de 62 e 85 m², piscina, academia e salão de festas, na Rua das Flores, 120, Batel, Curitiba/PR."
              className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-base outline-none focus:border-acento focus:ring-2 focus:ring-acento/30"
            />
          </label>
          <div>
            <Botao type="button" variante="secundario" onClick={() => void lerTexto()} disabled={ocupado || !texto.trim()}>
              {fase === 'lendo' ? 'Lendo...' : 'Entender o texto'}
            </Botao>
          </div>
        </div>
      </Cartao>

      {descricao && (
        <Cartao titulo="3. Confira o que eu entendi">
          <div className="grid gap-4" data-testid="entendido">
            {!planilha && (
              <div className="grid grid-cols-3 gap-3">
                <Campo id="criar-andares" rotulo="Andares" type="number" min={1} max={120} value={descricao.andares ?? ''} onChange={(e) => mudar({ andares: numero(e.target.value, 1, 120) })} disabled={ocupado} />
                <Campo id="criar-por-andar" rotulo="Por andar" type="number" min={1} max={20} value={descricao.unidadesPorAndar ?? ''} onChange={(e) => mudar({ unidadesPorAndar: numero(e.target.value, 1, 20) })} disabled={ocupado} />
                <Campo id="criar-torres" rotulo="Torres" type="number" min={1} max={6} value={descricao.torres ?? 1} onChange={(e) => mudar({ torres: numero(e.target.value, 1, 6) })} disabled={ocupado} />
              </div>
            )}
            {!planilha && (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Tipologias</legend>
                {descricao.tipologias.map((t, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2" data-testid="tipologia-entendida">
                    <span className="min-w-28 pb-2 text-sm font-medium">{t.nome}</span>
                    <label className="grid gap-1 text-xs">
                      Quartos
                      <input type="number" min={0} max={10} value={t.quartos} disabled={ocupado} onChange={(e) => mudarTipologia(i, { quartos: numero(e.target.value, 0, 10) ?? 0 })} className="w-20 rounded-lg border border-borda bg-superficie px-2 py-1" />
                    </label>
                    <label className="grid gap-1 text-xs">
                      Suítes
                      <input type="number" min={0} max={10} value={t.suites} disabled={ocupado} onChange={(e) => mudarTipologia(i, { suites: numero(e.target.value, 0, 10) ?? 0 })} className="w-20 rounded-lg border border-borda bg-superficie px-2 py-1" />
                    </label>
                    <label className="grid gap-1 text-xs">
                      Área (m²)
                      <input
                        type="number"
                        min={15}
                        max={2000}
                        value={t.areaM2 ?? ''}
                        placeholder="típica"
                        disabled={ocupado}
                        onChange={(e) => mudarTipologia(i, { areaM2: e.target.value ? Math.min(2000, Math.max(15, Number(e.target.value))) : null })}
                        className="w-24 rounded-lg border border-borda bg-superficie px-2 py-1"
                      />
                    </label>
                    <button type="button" className="pb-2 text-sm text-suave underline" disabled={ocupado} onClick={() => mudar({ tipologias: descricao.tipologias.filter((_, k) => k !== i) })}>
                      tirar
                    </button>
                  </div>
                ))}
                {descricao.tipologias.length < 8 && (
                  <div>
                    <button
                      type="button"
                      className="text-sm font-medium underline"
                      disabled={ocupado}
                      onClick={() => {
                        const q = Math.min(10, (descricao.tipologias.at(-1)?.quartos ?? 1) + 1);
                        mudar({ tipologias: [...descricao.tipologias, { nome: nomeTipologia(q, 0), quartos: q, suites: 0, areaM2: null }] });
                      }}
                    >
                      + tipologia
                    </button>
                  </div>
                )}
              </fieldset>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Lazer (vira o tour &quot;Conheça o lazer&quot;)</legend>
              <div className="flex flex-wrap gap-2">
                {descricao.lazer.map((l, i) => (
                  <button
                    key={`${l.nome}-${i}`}
                    type="button"
                    disabled={ocupado}
                    onClick={() => mudar({ lazer: descricao.lazer.filter((_, k) => k !== i) })}
                    className="rounded-full border border-acento/40 bg-acento/10 px-3 py-1 text-sm"
                    aria-label={`Tirar ${l.nome}`}
                    data-testid="lazer-entendido"
                  >
                    {l.nome} ✕
                  </button>
                ))}
                <select
                  aria-label="Adicionar lazer"
                  className="rounded-full border border-borda bg-superficie px-3 py-1 text-sm"
                  value=""
                  disabled={ocupado}
                  onChange={(e) => {
                    const c = e.target.value as CategoriaLazer;
                    if (c) mudar({ lazer: [...descricao.lazer, { categoria: c, nome: ROTULO_LAZER[c] }] });
                  }}
                >
                  <option value="">+ lazer</option>
                  {CATEGORIAS_LAZER.filter((c) => c !== 'outro').map((c) => (
                    <option key={c} value={c}>
                      {ROTULO_LAZER[c]}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Apartamento decorado (o que o cliente vê ao entrar na unidade)</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Estilo do apartamento decorado">
                {(
                  [
                    ['moderno', 'Moderno', 'cinza e madeira clara'],
                    ['classico', 'Clássico', 'piso de madeira e tons quentes'],
                    ['jovem', 'Jovem', 'cores vivas e madeira clara'],
                  ] as const
                ).map(([v, rotulo, dica]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={estilo === v}
                    disabled={ocupado}
                    onClick={() => setEstilo(v)}
                    className={`grid rounded-lg border px-3 py-2 text-left text-sm ${estilo === v ? 'border-acento bg-acento/10 font-semibold' : 'border-borda bg-superficie'}`}
                  >
                    {rotulo}
                    <span className="text-xs font-normal text-suave">{dica}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            {plano && !planilha && (
              <Aviso>
                <span data-testid="resumo-plano">
                  Vai criar <strong>{plano.unidades} unidades</strong> em {plano.andares} andares ({plano.porAndar} por andar
                  {plano.predios.length > 1 ? `, ${plano.predios.length} torres` : ''}): {plano.tipologias.map((t) => `${t.unidades} de ${t.nome}${t.areaM2 ? ` (${t.areaM2} m²)` : ''}`).join(', ')}
                  {plano.lazer.length ? `; lazer com ${plano.lazer.length} espaços` : ''}. Preço e situação de venda você põe depois (ou pela planilha).
                </span>
                {plano.avisos.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs">
                    {plano.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
              </Aviso>
            )}
            {!plano && !planilha && <Aviso tipo="erro">Diga quantos andares o prédio tem para eu montar as unidades.</Aviso>}
          </div>
        </Cartao>
      )}

      <Cartao titulo="4. Onde fica">
        <div className="grid gap-3 text-sm">
          {gps.length > 0 && <p data-testid="local-gps">📍 {gps.length} foto(s) com GPS: o lugar sai delas.</p>}
          {descricao && (
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
              <Campo id="criar-endereco" rotulo="Endereço" value={descricao.endereco ?? ''} maxLength={300} disabled={ocupado} onChange={(e) => mudar({ endereco: e.target.value.trim() ? e.target.value : null })} />
              <Campo id="criar-cidade" rotulo="Cidade" value={descricao.cidade ?? ''} maxLength={120} disabled={ocupado} onChange={(e) => mudar({ cidade: e.target.value.trim() ? e.target.value : null })} />
              <Selecao id="criar-uf" rotulo="UF" value={descricao.uf ?? ''} disabled={ocupado} onChange={(e) => mudar({ uf: e.target.value || null })}>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Selecao>
            </div>
          )}
          <div className="max-w-xs">
            <Campo id="criar-cep" rotulo="CEP (se não tiver o endereço)" inputMode="numeric" placeholder="00000-000" value={cep} maxLength={9} disabled={ocupado} onChange={(e) => setCep(e.target.value.replace(/[^\d-]/g, ''))} />
          </div>
          {!gps.length && !descricao?.endereco && !cep && <p className="text-suave">Sem endereço, sem GPS nas fotos e sem CEP, o empreendimento nasce sem a cidade em volta (dá para pôr depois).</p>}
        </div>
      </Cartao>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {fase === 'enviando' && totalBytes > 0 && (
        <div className="grid gap-1" data-testid="progresso-envio">
          <div className="h-2 overflow-hidden rounded-full bg-borda" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((enviadoBytes / totalBytes) * 100)} aria-label="Envio dos arquivos">
            <div className="h-full bg-acento transition-all" style={{ width: `${Math.round((enviadoBytes / totalBytes) * 100)}%` }} />
          </div>
          <p className="text-xs text-suave">
            Enviando {tamanhoLegivel(enviadoBytes)} de {tamanhoLegivel(totalBytes)}...
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Botao type="button" onClick={() => void criar()} disabled={ocupado || lendoArquivos > 0} data-testid="criar-empreendimento" className="min-h-12 px-6 text-base">
          {fase === 'criando' ? 'Criando...' : fase === 'enviando' ? 'Enviando os arquivos...' : fase === 'iniciando' ? 'Começando a montagem...' : criado && algumFalhou ? 'Tentar enviar de novo' : 'Criar o empreendimento 3D'}
        </Botao>
        {criado && algumFalhou && !ocupado && (
          <Botao type="button" variante="secundario" onClick={() => void criar(true)}>
            Seguir sem os que falharam
          </Botao>
        )}
      </div>
    </div>
  );
}
