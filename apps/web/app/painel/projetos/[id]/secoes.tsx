'use client';
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Botao, Selecao } from '@/components/ui';
import { ACEITA_POR_TIPO, ROTULO_CATEGORIA, ROTULO_TIPO_ARQUIVO, tamanhoLegivel, type Arquivo, type Poi, type TipoArquivo } from '@/lib/tipos';
import { apagarArquivo, buscarEndereco, concluirEnvio, importarPois, prepararEnvio, usarEndereco, type EstadoBusca, type EstadoPois } from './actions-arquivos';

const ROTULO_STATUS_ARQUIVO: Record<Arquivo['status'], string> = {
  aguardando_envio: 'Aguardando envio',
  verificando: 'Verificando',
  pronto: 'Pronto',
  rejeitado: 'Rejeitado',
};

/** PUT direto no armazenamento (link assinado), com progresso. */
function enviarComProgresso(url: string, cabecalhos: Record<string, string>, arquivo: File, aoProgredir: (p: number) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(cabecalhos)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && aoProgredir(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => reject(new Error('Falha de rede no envio.'));
    xhr.send(arquivo);
  });
}

export function SecaoArquivos({ projetoId, arquivos, podeEditar }: { projetoId: string; arquivos: Arquivo[]; podeEditar: boolean }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoArquivo>('modelo_3d');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [, iniciar] = useTransition();

  async function enviar() {
    if (!arquivo) return;
    setMensagem(null);
    const preparo = await prepararEnvio(projetoId, arquivo.name, tipo, arquivo.size);
    if (!preparo.ok) return setMensagem({ tipo: 'erro', texto: preparo.erro });
    setProgresso(0);
    try {
      const status = await enviarComProgresso(preparo.url, preparo.cabecalhos, arquivo, setProgresso);
      if (status >= 400 && status !== 413) throw new Error(`O armazenamento recusou o envio (${status}).`);
      const fim = await concluirEnvio(projetoId, preparo.id);
      setMensagem(
        fim.status === 'pronto'
          ? { tipo: 'sucesso', texto: `${arquivo.name} enviado e verificado.` }
          : { tipo: 'erro', texto: fim.erro ?? (status === 413 ? 'Arquivo maior que o declarado.' : 'Arquivo recusado na verificação.') },
      );
      setArquivo(null);
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setProgresso(null);
      router.refresh();
    }
  }

  return (
    <div className="grid gap-4">
      {arquivos.length === 0 ? (
        <p className="text-suave">Nenhum arquivo ainda.</p>
      ) : (
        <ul className="divide-y divide-borda" data-testid="lista-arquivos">
          {arquivos.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <strong>{a.nome}</strong> <span className="text-suave">· {ROTULO_TIPO_ARQUIVO[a.tipo]} · {tamanhoLegivel(a.tamanho)}</span>
              </span>
              <span className="flex items-center gap-3">
                <span data-status-arquivo={a.status} className={a.status === 'rejeitado' ? 'text-perigo' : a.status === 'pronto' ? 'text-sucesso' : 'text-suave'}>
                  {ROTULO_STATUS_ARQUIVO[a.status]}
                  {a.status === 'rejeitado' && a.motivoRejeicao ? `: ${a.motivoRejeicao}` : ''}
                  {a.status === 'pronto' && !a.verificadoAntivirus ? ' (sem antivírus)' : ''}
                </span>
                {a.status === 'pronto' && (
                  <a href={`/painel/arquivos/${a.id}`} className="underline">
                    Baixar
                  </a>
                )}
                {podeEditar && (
                  <button type="button" className="text-perigo underline" onClick={() => iniciar(async () => apagarArquivo(projetoId, a.id))}>
                    Apagar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {podeEditar && (
        <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <Selecao id="tipo-arquivo" rotulo="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoArquivo)}>
            {(Object.keys(ROTULO_TIPO_ARQUIVO) as TipoArquivo[]).map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_ARQUIVO[t]}
              </option>
            ))}
          </Selecao>
          <label htmlFor="arquivo-envio" className="grid gap-1 text-sm">
            <span className="font-medium">Arquivo</span>
            <input
              id="arquivo-envio"
              type="file"
              accept={ACEITA_POR_TIPO[tipo]}
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-lg file:border file:border-borda file:bg-superficie file:px-3 file:py-2"
            />
          </label>
          <Botao type="button" onClick={enviar} disabled={!arquivo || progresso !== null}>
            {progresso !== null ? `Enviando ${progresso}%` : 'Enviar arquivo'}
          </Botao>
          {progresso !== null && (
            <progress value={progresso} max={100} className="h-2 w-full sm:col-span-3" aria-label="Progresso do envio">
              {progresso}%
            </progress>
          )}
        </div>
      )}
      {mensagem && <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>}
    </div>
  );
}

export function SecaoArredores({ projetoId, temLocalizacao, pois, podeEditar }: { projetoId: string; temLocalizacao: boolean; pois: Poi[]; podeEditar: boolean }) {
  const router = useRouter();
  const [busca, enviarBusca, buscando] = useActionState<EstadoBusca, FormData>(buscarEndereco, {});
  const [importacao, enviarImportacao, importando] = useActionState<EstadoPois, FormData>(importarPois.bind(null, projetoId), {});
  const [erroUso, setErroUso] = useState<string | null>(null);
  const [usando, iniciar] = useTransition();

  return (
    <div className="grid gap-5">
      {podeEditar && (
        <form action={enviarBusca} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label htmlFor="busca-endereco" className="grid gap-1 text-sm">
            <span className="font-medium">Buscar endereço</span>
            <input
              id="busca-endereco"
              name="endereco"
              placeholder="Av. Paulista, 1000, São Paulo"
              className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-base outline-none focus:border-acento focus:ring-2 focus:ring-acento/30"
            />
          </label>
          <Botao type="submit" variante="secundario" disabled={buscando}>
            Buscar
          </Botao>
          {busca.erro && <Aviso tipo="erro">{busca.erro}</Aviso>}
          {busca.resultados && (
            <ul className="grid gap-2 sm:col-span-2">
              {busca.resultados.map((r) => (
                <li key={`${r.lat},${r.lon}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-borda p-3 text-sm">
                  <span>{r.rotulo}</span>
                  <Botao
                    type="button"
                    disabled={usando}
                    onClick={() =>
                      iniciar(async () => {
                        const res = await usarEndereco(projetoId, r.rotulo, r.lat, r.lon);
                        setErroUso(res.erro ?? null);
                        router.refresh();
                      })
                    }
                  >
                    Usar este
                  </Botao>
                </li>
              ))}
            </ul>
          )}
          {erroUso && <Aviso tipo="erro">{erroUso}</Aviso>}
        </form>
      )}

      {!temLocalizacao ? (
        <p className="text-suave">Defina a localização do empreendimento para ver os arredores.</p>
      ) : (
        <>
          {podeEditar && (
            <form action={enviarImportacao} className="flex flex-wrap items-end gap-3">
              <Selecao id="raio" name="raioM" rotulo="Raio" defaultValue="1000">
                <option value="500">500 m</option>
                <option value="1000">1 km</option>
                <option value="2000">2 km</option>
              </Selecao>
              <Botao type="submit" variante="secundario" disabled={importando}>
                {importando ? 'Buscando…' : 'Buscar pontos próximos (OpenStreetMap)'}
              </Botao>
              {importacao.erro && <Aviso tipo="erro">{importacao.erro}</Aviso>}
              {importacao.ok && <Aviso tipo="sucesso">{importacao.ok}</Aviso>}
            </form>
          )}
          {pois.length === 0 ? (
            <p className="text-suave">Nenhum ponto de interesse ainda.</p>
          ) : (
            <ul className="divide-y divide-borda text-sm" data-testid="lista-pois">
              {pois.map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <span className="text-suave">{ROTULO_CATEGORIA[p.categoria]} ·</span> {p.nome}
                  </span>
                  <span className="tabular-nums text-suave">
                    {p.distanciaM < 1000 ? `${p.distanciaM} m` : `${(p.distanciaM / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`} · ~{p.minutosAPe} min a pé
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-suave">Distância em linha reta; tempo a pé estimado a 80 m/min. Dados © OpenStreetMap contributors.</p>
        </>
      )}
    </div>
  );
}
