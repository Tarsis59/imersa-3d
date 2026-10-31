'use client';
import { useActionState, useState, useTransition } from 'react';
import { PADROES } from '@imersa/viewer';
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { ROTULO_CATEGORIA_MATERIAL, ROTULO_CATEGORIA_MOVEL, ROTULO_PADRAO, type CategoriaMaterial, type CategoriaMovel, type Material, type Movel } from '@/lib/configurador';
import { Amostra } from '@/components/amostra';
import { numeroBr } from '@/lib/configurador';
import type { Resultado } from './actions';

interface Acoes {
  criarMaterial: (estado: Resultado, f: FormData) => Promise<Resultado>;
  alterarMaterial: (id: string, mudanca: { precoM2?: number | null; ativo?: boolean }) => Promise<Resultado>;
  catalogoInicial: () => Promise<Resultado>;
  criarMovel: (estado: Resultado, f: FormData) => Promise<Resultado>;
  alterarMovel: (id: string, mudanca: { preco?: number | null; ativo?: boolean }) => Promise<Resultado>;
}



/** Preço editável na linha (Enter ou sair do campo salva). */
function PrecoEditavel({ rotulo, valor, salvar, desabilitado }: { rotulo: string; valor: number | null; salvar: (v: number | null) => Promise<Resultado>; desabilitado: boolean }) {
  const [texto, setTexto] = useState(valor === null ? '' : valor.toFixed(2).replace('.', ','));
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const enviar = () => {
    const v = numeroBr(texto);
    if (v !== null && !Number.isFinite(v)) return setEstado('Preço inválido');
    if (v === valor) return;
    iniciar(async () => {
      const r = await salvar(v === null ? null : Math.round(v * 100) / 100);
      setEstado(r.erro ?? 'Salvo');
    });
  };
  return (
    <span className="inline-flex items-center gap-2">
      <input
        aria-label={rotulo}
        inputMode="decimal"
        placeholder="sem preço"
        value={texto}
        disabled={desabilitado || ocupado}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={enviar}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), enviar())}
        className="w-28 rounded border border-borda bg-superficie px-2 py-1 text-right text-sm"
      />
      {estado && <span className="text-xs text-suave">{estado}</span>}
    </span>
  );
}

export function Catalogo({ materiais, moveis, glbs, podeEditar, acoes }: { materiais: Material[]; moveis: Movel[]; glbs: Array<{ id: string; nome: string }>; podeEditar: boolean; acoes: Acoes }) {
  const [estadoMaterial, enviarMaterial, criandoMaterial] = useActionState(acoes.criarMaterial, {});
  const [estadoMovel, enviarMovel, criandoMovel] = useActionState(acoes.criarMovel, {});
  const [inicial, setInicial] = useState<Resultado>({});
  const [ocupado, iniciar] = useTransition();
  const [padrao, setPadrao] = useState<(typeof PADROES)[number]>('porcelanato');
  const [cor, setCor] = useState('#d8cfbf');

  return (
    <div className="grid gap-6">
      {podeEditar && materiais.length === 0 && moveis.length === 0 && (
        <Cartao titulo="Começar rápido">
          <p className="mb-3 text-sm text-suave">
            Adiciona 19 acabamentos comuns em lançamentos (porcelanatos, vinílico, pinturas, telhas, esquadrias, bancadas) e 16 móveis padrão do
            Imersa (licença própria). Os materiais vêm sem preço: coloque o preço do seu fornecedor.
          </p>
          <Botao type="button" disabled={ocupado} onClick={() => iniciar(async () => setInicial(await acoes.catalogoInicial()))}>
            Adicionar catálogo inicial
          </Botao>
        </Cartao>
      )}
      {inicial.ok && <Aviso tipo="sucesso">{inicial.ok}</Aviso>}
      {inicial.erro && <Aviso tipo="erro">{inicial.erro}</Aviso>}

      <Cartao titulo={`Materiais (${materiais.length})`}>
        <ul className="divide-y divide-borda text-sm" data-testid="lista-materiais">
          {materiais.map((m) => (
            <li key={m.id} className={`flex flex-wrap items-center gap-3 py-2 ${m.ativo ? '' : 'opacity-50'}`}>
              <Amostra acabamento={m} tamanho={40} />
              <span className="grid min-w-48 flex-1">
                <strong>{m.nome}</strong>
                <span className="text-xs text-suave">
                  {ROTULO_CATEGORIA_MATERIAL[m.categoria]} · {ROTULO_PADRAO[m.padrao]} · peça de {m.escalaM.toLocaleString('pt-BR')} m{m.fornecedor ? ` · ${m.fornecedor}` : ''}
                  {m.ativo ? '' : ' · desativado'}
                </span>
              </span>
              <span className="text-xs text-suave">R$/m²</span>
              <PrecoEditavel rotulo={`Preço por m² de ${m.nome}`} valor={m.precoM2} desabilitado={!podeEditar} salvar={(v) => acoes.alterarMaterial(m.id, { precoM2: v })} />
              {podeEditar && (
                <Botao type="button" variante="secundario" onClick={() => iniciar(async () => void (await acoes.alterarMaterial(m.id, { ativo: !m.ativo })))}>
                  {m.ativo ? 'Desativar' : 'Reativar'}
                </Botao>
              )}
            </li>
          ))}
        </ul>
        {podeEditar && (
          <form action={enviarMaterial} className="mt-4 grid gap-3 border-t border-borda pt-4 sm:grid-cols-2">
            <h3 className="font-semibold sm:col-span-2">Novo material</h3>
            <Campo id="material-nome" name="nome" rotulo="Nome do material" required minLength={2} maxLength={120} />
            <Selecao id="material-categoria" name="categoria" rotulo="Onde vai" defaultValue="piso">
              {(Object.keys(ROTULO_CATEGORIA_MATERIAL) as CategoriaMaterial[]).map((c) => (
                <option key={c} value={c}>
                  {ROTULO_CATEGORIA_MATERIAL[c]}
                </option>
              ))}
            </Selecao>
            <Selecao id="material-padrao" name="padrao" rotulo="Desenho" value={padrao} onChange={(e) => setPadrao(e.target.value as typeof padrao)}>
              {PADROES.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PADRAO[p]}
                </option>
              ))}
            </Selecao>
            <label htmlFor="material-cor" className="grid gap-1 text-sm">
              <span className="font-medium">Cor</span>
              <span className="flex items-center gap-3">
                <input id="material-cor" name="cor" type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="h-10 w-16 rounded border border-borda" />
                <Amostra acabamento={{ padrao, cor, cor2: null }} tamanho={40} />
              </span>
            </label>
            <Campo id="material-escala" name="escalaM" rotulo="Tamanho da peça (m)" defaultValue="0,6" inputMode="decimal" />
            <Campo id="material-preco" name="precoM2" rotulo="Preço por m² (R$, opcional)" inputMode="decimal" placeholder="89,90" />
            <Campo id="material-rugosidade" name="rugosidade" rotulo="Fosco (1) ↔ brilhante (0)" defaultValue="0,8" inputMode="decimal" />
            <Campo id="material-fornecedor" name="fornecedor" rotulo="Fornecedor (opcional)" maxLength={120} />
            <input type="hidden" name="metalico" value="0" />
            <div className="sm:col-span-2">
              <Botao type="submit" disabled={criandoMaterial}>
                Cadastrar material
              </Botao>
            </div>
            {estadoMaterial.erro && <Aviso tipo="erro">{estadoMaterial.erro}</Aviso>}
            {estadoMaterial.ok && <Aviso tipo="sucesso">{estadoMaterial.ok}</Aviso>}
          </form>
        )}
      </Cartao>

      <Cartao titulo={`Móveis (${moveis.length})`}>
        <ul className="divide-y divide-borda text-sm" data-testid="lista-moveis">
          {moveis.map((m) => (
            <li key={m.id} className={`flex flex-wrap items-center gap-3 py-2 ${m.ativo ? '' : 'opacity-50'}`}>
              <span className="grid min-w-48 flex-1">
                <strong>{m.nome}</strong>
                <span className="text-xs text-suave">
                  {ROTULO_CATEGORIA_MOVEL[m.categoria]} · {m.modeloPadrao ? 'modelo padrão do Imersa' : `arquivo ${m.arquivoNome ?? ''}`} · licença: {m.licenca} · autor: {m.autor}
                  {m.fonteUrl && (
                    <>
                      {' · '}
                      <a href={m.fonteUrl} target="_blank" rel="noreferrer noopener" className="underline">
                        origem
                      </a>
                    </>
                  )}
                </span>
              </span>
              <span className="text-xs text-suave">R$</span>
              <PrecoEditavel rotulo={`Preço de ${m.nome}`} valor={m.preco} desabilitado={!podeEditar} salvar={(v) => acoes.alterarMovel(m.id, { preco: v })} />
              {podeEditar && (
                <Botao type="button" variante="secundario" onClick={() => iniciar(async () => void (await acoes.alterarMovel(m.id, { ativo: !m.ativo })))}>
                  {m.ativo ? 'Desativar' : 'Reativar'}
                </Botao>
              )}
            </li>
          ))}
        </ul>
        {podeEditar && (
          <form action={enviarMovel} className="mt-4 grid gap-3 border-t border-borda pt-4 sm:grid-cols-2">
            <h3 className="font-semibold sm:col-span-2">Novo móvel a partir de um modelo 3D (.glb) já enviado</h3>
            {glbs.length === 0 ? (
              <p className="text-sm text-suave sm:col-span-2">Envie o .glb do móvel em “Arquivos 3D e documentos” de um empreendimento; depois ele aparece aqui.</p>
            ) : (
              <>
                <Selecao id="movel-arquivo" name="arquivoId" rotulo="Arquivo 3D">
                  {glbs.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nome}
                    </option>
                  ))}
                </Selecao>
                <Campo id="movel-nome" name="nome" rotulo="Nome do móvel" required minLength={2} maxLength={120} />
                <Selecao id="movel-categoria" name="categoria" rotulo="Ambiente" defaultValue="sala">
                  {(Object.keys(ROTULO_CATEGORIA_MOVEL) as CategoriaMovel[]).map((c) => (
                    <option key={c} value={c}>
                      {ROTULO_CATEGORIA_MOVEL[c]}
                    </option>
                  ))}
                </Selecao>
                <Campo id="movel-preco" name="preco" rotulo="Preço (R$, opcional)" inputMode="decimal" />
                <Campo id="movel-licenca" name="licenca" rotulo="Licença do modelo 3D" required minLength={2} maxLength={120} placeholder="CC BY 4.0, comprada do fornecedor…" />
                <Campo id="movel-autor" name="autor" rotulo="Autor / dono do modelo" required minLength={2} maxLength={120} />
                <Campo id="movel-fonte" name="fonteUrl" rotulo="Página de origem (https, opcional)" type="url" />
                <div className="sm:col-span-2">
                  <Botao type="submit" disabled={criandoMovel}>
                    Cadastrar móvel
                  </Botao>
                </div>
              </>
            )}
            {estadoMovel.erro && <Aviso tipo="erro">{estadoMovel.erro}</Aviso>}
            {estadoMovel.ok && <Aviso tipo="sucesso">{estadoMovel.ok}</Aviso>}
          </form>
        )}
      </Cartao>
    </div>
  );
}

