'use client';
import { useActionState, useState } from 'react';
import { Aviso, Botao, Campo, Selecao } from '@/components/ui';
import { ROTULO_STATUS_PROJETO, type DetalheProjeto, type StatusProjeto } from '@/lib/tipos';
import type { EstadoForm, EstadoImportacao, ResumoImportacao } from './actions';
import { lerXlsx, tabelaParaCsv } from '@/lib/xlsx';

type Acao<E> = (estado: E, form: FormData) => Promise<E>;

function Retorno({ estado }: { estado: EstadoForm }) {
  if (estado.erro) return <Aviso tipo="erro">{estado.erro}</Aviso>;
  if (estado.ok) return <Aviso tipo="sucesso">{estado.ok}</Aviso>;
  return null;
}

export function FormDados({ projeto, acao }: { projeto: DetalheProjeto['projeto']; acao: Acao<EstadoForm> }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  return (
    <form action={enviar} className="grid gap-4 sm:grid-cols-2">
      <Campo id="nome" name="nome" rotulo="Nome" defaultValue={projeto.nome} required minLength={2} maxLength={120} />
      <Selecao id="status" name="status" rotulo="Fase" defaultValue={projeto.status}>
        {(Object.keys(ROTULO_STATUS_PROJETO) as StatusProjeto[]).map((s) => (
          <option key={s} value={s}>
            {ROTULO_STATUS_PROJETO[s]}
          </option>
        ))}
      </Selecao>
      <Selecao id="estilo-decorado" name="estiloDecorado" rotulo="Estilo do apartamento decorado" defaultValue={projeto.estiloDecorado}>
        <option value="moderno">Moderno</option>
        <option value="classico">Clássico</option>
        <option value="jovem">Jovem</option>
      </Selecao>
      <div className="sm:col-span-2">
        <Campo id="endereco" name="endereco" rotulo="Endereço" defaultValue={projeto.endereco ?? ''} maxLength={300} autoComplete="street-address" />
      </div>
      <Campo id="cidade" name="cidade" rotulo="Cidade" defaultValue={projeto.cidade ?? ''} maxLength={120} />
      <Campo id="uf" name="uf" rotulo="UF" defaultValue={projeto.uf ?? ''} maxLength={2} pattern="[A-Za-z]{2}" />
      <Campo id="lat" name="lat" rotulo="Latitude" defaultValue={projeto.lat ?? ''} inputMode="decimal" placeholder="-23.56175" />
      <Campo id="lon" name="lon" rotulo="Longitude" defaultValue={projeto.lon ?? ''} inputMode="decimal" placeholder="-46.6545" />
      <label htmlFor="descricao" className="grid gap-1 text-sm sm:col-span-2">
        <span className="font-medium">Descrição</span>
        <textarea
          id="descricao"
          name="descricao"
          rows={3}
          maxLength={4000}
          defaultValue={projeto.descricao ?? ''}
          className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-base outline-none focus:border-acento focus:ring-2 focus:ring-acento/30"
        />
      </label>
      <p className="text-sm text-suave sm:col-span-2">
        Dica: no Google Maps, clique com o botão direito no terreno e copie as coordenadas (latitude, longitude).
      </p>
      <div className="grid gap-3 sm:col-span-2">
        <Botao type="submit" disabled={pendente}>
          Salvar dados
        </Botao>
        <Retorno estado={estado} />
      </div>
    </form>
  );
}

export function FormPredio({ acao }: { acao: Acao<EstadoForm> }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  return (
    <form action={enviar} className="grid gap-4 sm:grid-cols-[1fr_140px_auto] sm:items-end">
      <Campo id="nome-predio" name="nome" rotulo="Nome do prédio" placeholder="Torre A" required maxLength={60} />
      <Campo id="andares" name="andares" rotulo="Andares" type="number" min={1} max={300} required />
      <Botao type="submit" disabled={pendente}>
        Criar prédio
      </Botao>
      <label className="flex items-center gap-2 text-sm sm:col-span-3">
        <input type="checkbox" name="incluirTerreo" className="size-4 accent-acento" /> Incluir térreo
      </label>
      <div className="sm:col-span-3">
        <Retorno estado={estado} />
      </div>
    </form>
  );
}

export function FormTipologia({ acao }: { acao: Acao<EstadoForm> }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  return (
    <form action={enviar} className="grid gap-4 sm:grid-cols-5 sm:items-end">
      <div className="sm:col-span-2">
        <Campo id="nome-tipologia" name="nome" rotulo="Nome da tipologia" placeholder="Tipo 2 quartos" required maxLength={60} />
      </div>
      <Campo id="areaM2" name="areaM2" rotulo="Área (m²)" inputMode="decimal" required />
      <Campo id="quartos" name="quartos" rotulo="Quartos" type="number" min={0} max={50} defaultValue={2} required />
      <Campo id="suites" name="suites" rotulo="Suítes" type="number" min={0} max={50} defaultValue={0} required />
      <Campo id="vagas" name="vagas" rotulo="Vagas" type="number" min={0} max={50} defaultValue={1} required />
      <div className="sm:col-span-4">
        <Retorno estado={estado} />
      </div>
      <Botao type="submit" disabled={pendente}>
        Criar tipologia
      </Botao>
    </form>
  );
}

const ROTULOS_RESUMO: Array<[keyof ResumoImportacao, string]> = [
  ['prediosNovos', 'prédios novos'],
  ['andaresNovos', 'andares novos'],
  ['tipologiasNovas', 'tipologias novas'],
  ['unidadesNovas', 'unidades novas'],
  ['unidadesAlteradas', 'unidades alteradas'],
  ['statusAlterados', 'status alterados'],
  ['semMudanca', 'sem mudança'],
];

/**
 * .xlsx: lido no navegador e convertido em CSV (a importação é a mesma).
 * CSV: o Excel em português costuma salvar em Windows-1252; tenta UTF-8 e cai para ele se precisar.
 */
async function lerArquivoTexto(arquivo: File): Promise<string> {
  const bytes = await arquivo.arrayBuffer();
  if (arquivo.name.toLowerCase().endsWith('.xlsx')) return tabelaParaCsv(lerXlsx(new Uint8Array(bytes)));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const mesmasLinhas = (a: string, b: string) => a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n');

function ResultadoImportacao({ estado }: { estado: EstadoImportacao }) {
  if (estado.erro) return <Aviso tipo="erro">{estado.erro}</Aviso>;
  if (estado.erros && estado.erros.length > 0) {
    return (
      <div className="grid gap-2" role="alert">
        <p className="text-sm font-semibold text-perigo">
          {estado.erros.length} {estado.erros.length === 1 ? 'problema encontrado' : 'problemas encontrados'}. Nada foi gravado. Corrija e faça a prévia de novo.
        </p>
        <div className="max-h-72 overflow-auto rounded-lg border border-borda">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-fundo">
              <tr>
                <th className="px-3 py-2">Linha</th>
                <th className="px-3 py-2">Campo</th>
                <th className="px-3 py-2">Problema</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {estado.erros.map((e, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 tabular-nums">{e.linha || '—'}</td>
                  <td className="px-3 py-2">{e.campo}</td>
                  <td className="px-3 py-2">{e.mensagem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  if (!estado.resumo) return null;
  const itens = ROTULOS_RESUMO.filter(([chave]) => estado.resumo![chave] > 0);
  return (
    <Aviso tipo={estado.aplicado ? 'sucesso' : 'info'}>
      <strong>{estado.aplicado ? 'Importação aplicada.' : 'Prévia (nada foi gravado).'}</strong>
      <ul className="mt-1 list-inside list-disc">
        {itens.map(([chave, rotulo]) => (
          <li key={chave}>
            {estado.resumo![chave]} {rotulo}
          </li>
        ))}
      </ul>
    </Aviso>
  );
}

export function FormImportacao({ previa, aplicar }: { previa: Acao<EstadoImportacao>; aplicar: Acao<EstadoImportacao> }) {
  const [estadoPrevia, enviarPrevia, conferindo] = useActionState(previa, {});
  const [estadoAplicar, enviarAplicar, aplicando] = useActionState(aplicar, {});
  const [csv, setCsv] = useState('');
  const [ultimo, setUltimo] = useState<'previa' | 'aplicar' | null>(null);
  const acabouDeAplicar = ultimo === 'aplicar' && Boolean(estadoAplicar.aplicado);
  // O navegador envia quebras de linha de <textarea> como \r\n: compara sem essa diferença.
  const conferidoAgora = Boolean(estadoPrevia.conferido) && mesmasLinhas(estadoPrevia.conferido!, csv);
  const podeAplicar = conferidoAgora && !acabouDeAplicar;
  const pendente = conferindo || aplicando;
  return (
    <form className="grid gap-4">
      <p className="text-sm text-suave">
        Cole a planilha (CSV com <code>;</code> ou <code>,</code>) ou escolha o arquivo. Colunas obrigatórias: <code>predio</code>, <code>andar</code>,{' '}
        <code>codigo</code>.{' '}
        <a href="/modelo-unidades.csv" download className="font-semibold underline">
          Baixar modelo
        </a>
      </p>
      <label htmlFor="arquivo-csv" className="grid gap-1 text-sm">
        <span className="font-medium">Arquivo (.csv ou .xlsx)</span>
        <input
          id="arquivo-csv"
          type="file"
          accept=".csv,.xlsx,text/csv"
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-borda file:bg-superficie file:px-3 file:py-2"
          onChange={async (e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) setCsv(await lerArquivoTexto(arquivo));
          }}
        />
      </label>
      <label htmlFor="csv" className="grid gap-1 text-sm">
        <span className="font-medium">Conteúdo da planilha</span>
        <textarea
          id="csv"
          name="csv"
          rows={8}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          spellCheck={false}
          className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 font-mono text-xs outline-none focus:border-acento focus:ring-2 focus:ring-acento/30"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <Botao type="submit" variante="secundario" formAction={enviarPrevia} onClick={() => setUltimo('previa')} disabled={pendente}>
          Prévia
        </Botao>
        <Botao type="submit" formAction={enviarAplicar} onClick={() => setUltimo('aplicar')} disabled={pendente || !podeAplicar}>
          Aplicar
        </Botao>
        {!podeAplicar && !pendente && !acabouDeAplicar && <span className="self-center text-sm text-suave">Faça a prévia sem erros para liberar o Aplicar.</span>}
      </div>
      {ultimo === 'previa' && <ResultadoImportacao estado={estadoPrevia} />}
      {ultimo === 'aplicar' && <ResultadoImportacao estado={estadoAplicar} />}
    </form>
  );
}
