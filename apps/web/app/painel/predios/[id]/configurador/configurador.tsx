'use client';
import { startTransition, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { criarViewer, type FonteMovel, type Superficie, type UnidadeViewer, type Viewer } from '@imersa/viewer';
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { Amostra } from '@/components/amostra';
import { DECODIFICADORES } from '@/lib/decodificadores';
import {
  acabamentoDe,
  m2,
  materiaisPara,
  previaOrcamento,
  reais,
  ROTULO_CATEGORIA_MOVEL,
  type ConfiguracaoDetalhe,
  type ConfiguracaoResumo,
  type Material,
  type Movel,
  type MovelColocado,
  type Orcamento,
} from '@/lib/configurador';
import { ESTILOS, LISTA_ESTILOS, escolhasDoEstilo, type Estilo } from '@/lib/estilos';
import { lerPedidosAcabamento, materialDoPedido, superficiesDoPedido } from '@/lib/acabamento-por-texto';
import type { DadosSalvar } from './actions';

const PASSO_M = 0.1;
const novaInstancia = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Tabela do orçamento (prévia ou oficial). */
function TabelaOrcamento({ orcamento, testid }: { orcamento: Orcamento; testid: string }) {
  if (!orcamento.linhas.length) return <p className="text-sm text-suave">Escolha acabamentos ou coloque móveis para montar o orçamento.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid={testid}>
        <thead className="text-left text-xs text-suave">
          <tr>
            <th className="py-1 pr-2 font-medium">Item</th>
            <th className="py-1 pr-2 text-right font-medium">Quantidade</th>
            <th className="py-1 pr-2 text-right font-medium">Preço</th>
            <th className="py-1 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {orcamento.linhas.map((l, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                {l.item}
                <span className="block text-xs text-suave">{l.descricao}</span>
              </td>
              <td className="py-1 pr-2 text-right">{l.unidade === 'm²' ? m2(l.quantidade) : `${l.quantidade} un`}</td>
              <td className="py-1 pr-2 text-right">{l.precoUnitario === null ? 'sem preço' : `${reais(l.precoUnitario)}${l.unidade === 'm²' ? '/m²' : ''}`}</td>
              <td className="py-1 text-right">{l.precoUnitario === null ? '—' : reais(l.valor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="pt-2" colSpan={3}>
              Total{orcamento.semPreco > 0 ? ` (${orcamento.semPreco} ${orcamento.semPreco === 1 ? 'item' : 'itens'} sem preço fora da soma)` : ''}
            </td>
            <td className="pt-2 text-right" data-testid={`${testid}-total`}>
              {reais(orcamento.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function Configurador({
  predioId,
  modeloUrl,
  unidades,
  materiais,
  moveis,
  salvas,
  aberta,
  salvar,
  apagar,
  linkDoArquivo,
}: {
  predioId: string;
  modeloUrl: string;
  unidades: UnidadeViewer[];
  materiais: Material[];
  moveis: Movel[];
  salvas: ConfiguracaoResumo[];
  aberta: ConfiguracaoDetalhe | null;
  salvar: (configuracaoId: string | null, d: DadosSalvar) => Promise<{ erro?: string; id?: string; orcamento?: Orcamento }>;
  apagar: (configuracaoId: string) => Promise<{ erro?: string }>;
  linkDoArquivo: (arquivoId: string) => Promise<string | null>;
}) {
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [superficies, setSuperficies] = useState<Superficie[]>([]);
  const [escolha, setEscolha] = useState<Record<string, string | null>>(() => Object.fromEntries((aberta?.escolhas.superficies ?? []).map((s) => [s.chave, s.materialId])));
  const [colocados, setColocados] = useState<MovelColocado[]>(aberta?.escolhas.moveis ?? []);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [colocando, setColocando] = useState<string | null>(null);
  const [ultimaTroca, setUltimaTroca] = useState<{ trabalhoMs: number; ateQuadroMs: number; n: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // decoração com um toque: o estilo escolhido e quanto levou até a tela mostrar tudo trocado
  const [estilo, setEstilo] = useState<{ nome: Estilo; ms: number | null } | null>(null);
  const [nome, setNome] = useState(aberta?.nome ?? '');
  const [cliente, setCliente] = useState(aberta?.cliente ?? '');
  const [unidadeId, setUnidadeId] = useState(aberta?.unidadeId ?? '');
  const [configuracaoId, setConfiguracaoId] = useState<string | null>(aberta?.id ?? null);
  const [resultado, setResultado] = useState<{ erro?: string; orcamento?: Orcamento } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const catalogoMoveis = useMemo(() => new Map(moveis.map((m) => [m.id, m])), [moveis]);

  // o viewer é criado uma vez; o que ele precisa no início fica guardado aqui
  const inicial = useRef({ modeloUrl, unidades, escolha, colocados, materiais, catalogoMoveis, linkDoArquivo });

  async function fonteDe(m: Movel, link = linkDoArquivo): Promise<FonteMovel> {
    if (m.modeloPadrao) return { padrao: m.modeloPadrao };
    const url = m.arquivoId ? await link(m.arquivoId) : null;
    if (!url) throw new Error('arquivo do móvel indisponível');
    return { url };
  }

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const c = inicial.current;
    const v = criarViewer(el, { unidades: c.unidades, modeloUrl: c.modeloUrl, decodificadores: DECODIFICADORES, configurador: true });
    viewer.current = v;
    let vivo = true;
    v.aoSelecionarMovel((id) => vivo && setSelecionado(id));
    // FPS e qualidade na tela (atributos para quem mede: testes e telemetria visual)
    v.aoMudar((e) => {
      if (vivo && canvas.current?.parentElement) Object.assign(canvas.current.parentElement.dataset, { fps: String(e.fps), qualidade: e.nivel });
    });
    v.pronto.then(
      async () => {
        if (!vivo) return;
        setSuperficies(v.superficies());
        // texturas do catálogo já desenhadas e na placa de vídeo: a troca na frente da cliente só muda números
        await v.prepararAcabamentos(c.materiais.map(acabamentoDe));
        // combinação reaberta: acabamentos e móveis como foram salvos
        for (const [chave, materialId] of Object.entries(c.escolha)) {
          const m = c.materiais.find((x) => x.id === materialId);
          if (m) await v.definirAcabamento(chave, acabamentoDe(m));
        }
        for (const x of c.colocados) {
          const m = c.catalogoMoveis.get(x.movelId);
          if (m) await v.colocarMovel(x.instanciaId, await fonteDe(m, c.linkDoArquivo), x.pose).catch(() => setAviso(`Não foi possível abrir o móvel "${m.nome}".`));
        }
        if (vivo) setEstado('pronto');
      },
      () => vivo && setEstado('erro'),
    );
    return () => {
      vivo = false;
      v.destruir();
      viewer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function colocar(movelId: string, ponto: { x: number; y: number; z: number }) {
    const v = viewer.current;
    const m = catalogoMoveis.get(movelId);
    if (!v || !m) return;
    const id = novaInstancia();
    try {
      const pose = await v.colocarMovel(id, await fonteDe(m), { ...ponto, giroGraus: 0 });
      setColocados((l) => [...l, { instanciaId: id, movelId, pose }]);
      setSelecionado(id);
      setAviso(null);
    } catch {
      setAviso(`Não foi possível colocar "${m.nome}".`);
    }
    setColocando(null);
  }

  // modo "clique no piso": o próximo clique no 3D diz onde o móvel vai
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.aoClicarPiso(colocando ? (p) => void colocar(colocando, p) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colocando, estado]);

  async function trocar(chave: string, materialId: string | null) {
    const m = materialId ? materiais.find((x) => x.id === materialId) : undefined;
    // o 3D troca primeiro; o resto da tela (prévia do orçamento, amostras) atualiza como transição, sem segurar o quadro
    const ms = viewer.current?.definirAcabamento(chave, m ? acabamentoDe(m) : null);
    startTransition(() => {
      setEscolha((e) => ({ ...e, [chave]: materialId }));
      setEstilo(null); // mexeu à mão: já não é o estilo pronto
    });
    const tempo = await ms;
    if (tempo) startTransition(() => setUltimaTroca((t) => ({ ...tempo, n: (t?.n ?? 0) + 1 })));
  }

  /** Todas as superfícies de uma vez, com o material do catálogo que combina com o estilo. */
  // pedido por texto (Plano 11e, item 21): "piso de madeira na sala, parede verde no quarto"
  const [pedidoTexto, setPedidoTexto] = useState('');
  const [retornoTexto, setRetornoTexto] = useState<string | null>(null);
  async function pedirPorTexto() {
    const pedidos = lerPedidosAcabamento(pedidoTexto);
    if (!pedidos.length) return setRetornoTexto('Não entendi. Ex.: "piso de madeira na sala, parede verde no quarto".');
    const feitos: string[] = [];
    const faltas: string[] = [];
    for (const p of pedidos) {
      const chaves = superficiesDoPedido(p, superficies);
      const m = materialDoPedido(p, materiais);
      if (!chaves.length) faltas.push(`não achei ${p.categoria}${p.comodo ? ` em ${p.comodo}` : ''} neste modelo`);
      else if (!m) faltas.push(`o catálogo não tem ${p.categoria} parecido com "${p.frase}"`);
      else {
        for (const c of chaves) await trocar(c, m.id);
        feitos.push(`${m.nome} em ${chaves.length} superfície${chaves.length > 1 ? 's' : ''}`);
      }
    }
    setRetornoTexto([feitos.length ? `Troquei: ${feitos.join('; ')}.` : '', faltas.length ? `Não deu: ${faltas.join('; ')}.` : ''].filter(Boolean).join(' '));
    if (feitos.length) setPedidoTexto('');
  }

  async function aplicarEstilo(nome: Estilo) {
    const v = viewer.current;
    if (!v) return;
    const inicio = performance.now();
    const novas = escolhasDoEstilo(nome, superficies, materiais);
    const trocas = Object.entries(novas).map(([chave, id]) => {
      const m = materiais.find((x) => x.id === id);
      return m ? v.definirAcabamento(chave, acabamentoDe(m)) : null;
    });
    startTransition(() => {
      setEscolha((e) => ({ ...e, ...novas }));
      setEstilo({ nome, ms: null });
    });
    await Promise.all(trocas);
    const ms = Math.round(performance.now() - inicio);
    startTransition(() => setEstilo((e) => (e?.nome === nome ? { nome, ms } : e)));
  }

  function mover(dx: number, dz: number, giro = 0) {
    const v = viewer.current;
    if (!v || !selecionado) return;
    setColocados((l) =>
      l.map((x) => {
        if (x.instanciaId !== selecionado) return x;
        const pose = v.moverMovel(x.instanciaId, { ...x.pose, x: x.pose.x + dx, z: x.pose.z + dz, giroGraus: x.pose.giroGraus + giro });
        return pose ? { ...x, pose } : x;
      }),
    );
  }

  function remover() {
    if (!selecionado) return;
    viewer.current?.removerMovel(selecionado);
    setColocados((l) => l.filter((x) => x.instanciaId !== selecionado));
    setSelecionado(null);
  }

  const escolhas = superficies.map((s) => ({ chave: s.chave, rotulo: s.rotulo, areaM2: s.areaM2, materialId: escolha[s.chave] ?? null }));
  const previa = previaOrcamento(escolhas, colocados, materiais, moveis);
  const movelSelecionado = colocados.find((x) => x.instanciaId === selecionado);
  const nomeDe = (x: MovelColocado) => catalogoMoveis.get(x.movelId)?.nome ?? 'Móvel';

  function enviar() {
    iniciar(async () => {
      const r = await salvar(configuracaoId, { nome, cliente, unidadeId: unidadeId || null, superficies: escolhas, moveis: colocados });
      setResultado(r);
      if (r.id) {
        setConfiguracaoId(r.id);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-6">
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-borda bg-[#bfd9f2]"
        data-testid="configurador-3d"
        data-estado={estado}
        data-troca-ms={ultimaTroca?.ateQuadroMs ?? ''}
        data-troca-trabalho-ms={ultimaTroca?.trabalhoMs ?? ''}
        data-trocas={ultimaTroca?.n ?? 0}
        data-moveis={colocados.length}
      >
        <canvas ref={canvas} className={`h-full w-full touch-none ${colocando ? 'cursor-crosshair' : ''}`} aria-label="Modelo 3D do prédio para personalizar" />
        {estado === 'carregando' && <p className="absolute inset-0 grid place-items-center text-sm text-suave">Carregando o modelo 3D e os acabamentos…</p>}
        {estado === 'erro' && <p className="absolute inset-0 grid place-items-center text-sm text-perigo">Não foi possível abrir o modelo 3D.</p>}
        {colocando && (
          <p className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs text-white" role="status">
            Clique no piso onde vai o móvel ·{' '}
            <button type="button" className="underline" onClick={() => setColocando(null)}>
              cancelar
            </button>
          </p>
        )}
        {ultimaTroca !== null && (
          <p className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-white" data-testid="tempo-troca">
            Troca na tela em {ultimaTroca.ateQuadroMs} ms
          </p>
        )}
      </div>
      {aviso && <Aviso tipo="erro">{aviso}</Aviso>}

      <div className="grid gap-6 md:grid-cols-2">
        <Cartao titulo="Acabamentos">
          {estado === 'pronto' && superficies.length === 0 && <p className="text-sm text-suave">Este modelo não tem superfícies que possam ser trocadas.</p>}
          {superficies.length > 0 && (
            <form
                className="mb-4 grid gap-2"
                data-testid="acabamento-por-texto"
                onSubmit={(e) => {
                  e.preventDefault();
                  void pedirPorTexto();
                }}
              >
                <label htmlFor="pedido-acabamento" className="text-sm font-medium">
                  Peça por texto
                </label>
                <div className="flex gap-2">
                  <input
                    id="pedido-acabamento"
                    value={pedidoTexto}
                    maxLength={400}
                    disabled={estado !== 'pronto'}
                    onChange={(e) => setPedidoTexto(e.target.value)}
                    placeholder="Ex.: piso de madeira na sala, parede verde no quarto"
                    className="min-w-0 flex-1 rounded-lg border border-borda bg-superficie px-3 py-2 text-sm"
                  />
                  <button type="submit" disabled={estado !== 'pronto' || !pedidoTexto.trim()} className="rounded-lg bg-acento px-3 text-sm font-semibold text-acento-texto disabled:opacity-50">
                    Trocar
                  </button>
                </div>
                {retornoTexto && (
                  <p role="status" className="text-sm text-suave" data-testid="retorno-acabamento">
                    {retornoTexto}
                  </p>
                )}
              </form>
          )}
          {superficies.length > 0 && (
            <fieldset className="mb-4 grid gap-2" data-testid="estilos">
              <legend className="text-sm font-medium">Decoração com um toque</legend>
              <div className="grid grid-cols-3 gap-2">
                {LISTA_ESTILOS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    disabled={estado !== 'pronto'}
                    aria-pressed={estilo?.nome === e}
                    title={ESTILOS[e].descricao}
                    onClick={() => void aplicarEstilo(e)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 ${estilo?.nome === e ? 'border-acento bg-acento text-acento-texto' : 'border-borda hover:bg-fundo'}`}
                  >
                    {ESTILOS[e].rotulo}
                  </button>
                ))}
              </div>
              <p className="text-xs text-suave" data-testid="tempo-estilo" data-ms={estilo?.ms ?? ''}>
                {estilo
                  ? `${ESTILOS[estilo.nome].descricao}.${estilo.ms !== null ? ` Aplicado em ${estilo.ms} ms.` : ''}`
                  : 'Escolha um estilo: todas as superfícies trocam de uma vez, com os materiais do seu catálogo. Depois dá para ajustar cada uma.'}
              </p>
            </fieldset>
          )}
          <div className="grid gap-3">
            {superficies.map((s) => {
              const opcoes = materiaisPara(s, materiais);
              const atual = materiais.find((m) => m.id === escolha[s.chave]);
              return (
                <div key={s.chave} className="flex items-end gap-3">
                  {atual ? <Amostra acabamento={atual} tamanho={40} /> : <span className="h-10 w-10 shrink-0 rounded border border-dashed border-borda" aria-hidden />}
                  <div className="flex-1">
                    <Selecao
                      id={`superficie-${s.chave}`}
                      rotulo={`${s.rotulo} · ${m2(s.areaM2)}`}
                      aria-label={`Acabamento: ${s.rotulo}`}
                      value={escolha[s.chave] ?? ''}
                      disabled={estado !== 'pronto'}
                      onChange={(e) => void trocar(s.chave, e.target.value || null)}
                    >
                      <option value="">Original do projeto</option>
                      {opcoes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nome}
                          {m.precoM2 !== null ? ` · ${reais(m.precoM2)}/m²` : ''}
                        </option>
                      ))}
                    </Selecao>
                  </div>
                </div>
              );
            })}
          </div>
          {superficies.length > 0 && <p className="mt-3 text-xs text-suave">Áreas medidas no modelo 3D (faces visíveis); confira com o memorial antes de fechar o pedido.</p>}
        </Cartao>

        <Cartao titulo="Móveis">
          <div className="grid gap-3">
            <Selecao id="movel-escolhido" rotulo="Móvel do catálogo" value={colocando ?? ''} disabled={estado !== 'pronto' || moveis.length === 0} onChange={(e) => setColocando(e.target.value || null)}>
              <option value="">{moveis.length ? 'Escolha e clique no piso…' : 'Catálogo de móveis vazio'}</option>
              {moveis.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} ({ROTULO_CATEGORIA_MOVEL[m.categoria]}){m.preco !== null ? ` · ${reais(m.preco)}` : ''}
                </option>
              ))}
            </Selecao>
            {colocando && (
              <Botao type="button" variante="secundario" onClick={() => void colocar(colocando, viewer.current?.pisoAbaixo(0, 0) ?? { x: 0, y: 0, z: 0 })}>
                Colocar no centro do térreo
              </Botao>
            )}
            <ul className="divide-y divide-borda text-sm" data-testid="lista-moveis-colocados">
              {colocados.map((x) => (
                <li key={x.instanciaId} className="flex items-center justify-between gap-2 py-1">
                  <button type="button" className={`text-left ${x.instanciaId === selecionado ? 'font-semibold text-acento' : ''}`} onClick={() => setSelecionado(x.instanciaId)}>
                    {nomeDe(x)}
                  </button>
                  <span className="text-xs text-suave">
                    x {x.pose.x.toFixed(2)} · z {x.pose.z.toFixed(2)} · {x.pose.giroGraus}°
                  </span>
                </li>
              ))}
            </ul>
            {movelSelecionado && (
              <div className="grid gap-2" role="group" aria-label={`Ajustar ${nomeDe(movelSelecionado)}`}>
                <span className="text-sm font-medium">Ajustar: {nomeDe(movelSelecionado)}</span>
                <div className="flex flex-wrap gap-2">
                  <Botao type="button" variante="secundario" aria-label="Mover para a esquerda" onClick={() => mover(-PASSO_M, 0)}>
                    ←
                  </Botao>
                  <Botao type="button" variante="secundario" aria-label="Mover para a frente" onClick={() => mover(0, -PASSO_M)}>
                    ↑
                  </Botao>
                  <Botao type="button" variante="secundario" aria-label="Mover para trás" onClick={() => mover(0, PASSO_M)}>
                    ↓
                  </Botao>
                  <Botao type="button" variante="secundario" aria-label="Mover para a direita" onClick={() => mover(PASSO_M, 0)}>
                    →
                  </Botao>
                  <Botao type="button" variante="secundario" onClick={() => mover(0, 0, 90)}>
                    Girar 90°
                  </Botao>
                  <Botao type="button" variante="perigo" onClick={remover}>
                    Remover
                  </Botao>
                </div>
              </div>
            )}
          </div>
        </Cartao>
      </div>

      <Cartao titulo="Orçamento (prévia)">
        <TabelaOrcamento orcamento={previa} testid="previa-orcamento" />
        <p className="mt-2 text-xs text-suave">O valor oficial é calculado ao salvar, com os preços do catálogo naquele momento.</p>
      </Cartao>

      <Cartao titulo={configuracaoId ? 'Salvar alterações da combinação' : 'Salvar combinação'}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo id="config-nome" rotulo="Nome da combinação" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Opção A — clara" maxLength={120} />
          <Campo id="config-cliente" rotulo="Cliente (opcional)" value={cliente} onChange={(e) => setCliente(e.target.value)} maxLength={120} />
          <Selecao id="config-unidade" rotulo="Unidade (opcional)" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">—</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.codigo}
              </option>
            ))}
          </Selecao>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Botao type="button" onClick={enviar} disabled={ocupado || estado !== 'pronto' || nome.trim().length < 2}>
            {configuracaoId ? 'Salvar alterações' : 'Salvar combinação'}
          </Botao>
          {configuracaoId && (
            <Link href={`/painel/configuracoes/${configuracaoId}`} className="text-sm font-semibold underline">
              Ver orçamento para imprimir
            </Link>
          )}
        </div>
        {resultado?.erro && (
          <div className="mt-3">
            <Aviso tipo="erro">{resultado.erro}</Aviso>
          </div>
        )}
        {resultado?.orcamento && (
          <div className="mt-3 grid gap-2">
            <Aviso tipo="sucesso">Combinação salva. Total oficial: {reais(resultado.orcamento.total)}.</Aviso>
          </div>
        )}
      </Cartao>

      <Cartao titulo={`Combinações salvas (${salvas.length})`}>
        {salvas.length === 0 ? (
          <p className="text-sm text-suave">Nenhuma combinação salva ainda.</p>
        ) : (
          <ul className="divide-y divide-borda text-sm" data-testid="lista-configuracoes">
            {salvas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="grid">
                  <strong>{c.nome}</strong>
                  <span className="text-xs text-suave">
                    {[c.cliente, c.unidadeCodigo ? `unidade ${c.unidadeCodigo}` : null, c.criadoPor?.nome].filter(Boolean).join(' · ')} · {reais(c.total)}
                  </span>
                </span>
                <span className="flex flex-wrap gap-3">
                  <Link href={`/painel/predios/${predioId}/configurador?configuracao=${c.id}`} className="font-medium underline">
                    Abrir
                  </Link>
                  <Link href={`/painel/configuracoes/${c.id}`} className="font-medium underline">
                    Orçamento
                  </Link>
                  <button
                    type="button"
                    className="font-medium text-perigo underline"
                    onClick={() =>
                      iniciar(async () => {
                        const r = await apagar(c.id);
                        if (r.erro) setAviso(r.erro);
                        else if (c.id === configuracaoId) setConfiguracaoId(null);
                        router.refresh();
                      })
                    }
                  >
                    Apagar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}

