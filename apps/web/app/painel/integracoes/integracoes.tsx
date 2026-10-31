'use client';
import { useState, useTransition } from 'react';
import { Aviso, Botao, Campo, Cartao } from '@/components/ui';

export interface DadosIntegracoes {
  chaves: Array<{ id: string; nome: string; prefixo: string; criadoEm: string; ultimoUso: string | null; revogadaEm: string | null }>;
  webhooks: Array<{ id: string; url: string; eventos: string[]; ativo: boolean; criadoEm: string; entregues: number; pendentes: number; falhas: number }>;
}
type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: string };
interface Acoes {
  criarChave: (nome: string) => Promise<Resultado<{ chave: string }>>;
  revogarChave: (id: string) => Promise<Resultado<object>>;
  criarWebhook: (url: string, eventos: string[]) => Promise<Resultado<{ segredo: string }>>;
  apagarWebhook: (id: string) => Promise<Resultado<object>>;
  testarWebhook: (id: string) => Promise<Resultado<object>>;
}

const EVENTOS = [
  { id: 'lead.criado', rotulo: 'Novo pedido de contato (lead)' },
  { id: 'unidade.status', rotulo: 'Mudança de status de unidade' },
] as const;
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca');

/** Valor mostrado uma única vez (chave ou segredo): o banco não guarda o original. */
function UmaVez({ titulo, valor, testid }: { titulo: string; valor: string; testid: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="grid gap-2 rounded-xl border border-acento/40 bg-acento/5 p-4 text-sm">
      <p className="font-medium">{titulo} Copie agora: por segurança ele não aparece de novo.</p>
      <code data-testid={testid} className="break-all rounded bg-superficie px-2 py-1">
        {valor}
      </code>
      <Botao
        type="button"
        variante="secundario"
        className="w-fit"
        onClick={async () => {
          await navigator.clipboard?.writeText(valor).catch(() => undefined);
          setCopiado(true);
        }}
      >
        {copiado ? 'Copiado ✓' : 'Copiar'}
      </Botao>
    </div>
  );
}

export function Integracoes({ dados, acoes }: { dados: DadosIntegracoes; acoes: Acoes }) {
  const [ocupado, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [nomeChave, setNomeChave] = useState('');
  const [chaveNova, setChaveNova] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [eventos, setEventos] = useState<string[]>(['lead.criado']);
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const rodar = <T,>(fn: () => Promise<Resultado<T>>, depois?: (r: { ok: true } & T) => void) =>
    iniciar(async () => {
      setErro(null);
      setAviso(null);
      const r = await fn();
      if (!r.ok) return setErro(r.erro);
      depois?.(r);
    });

  return (
    <div className="grid gap-6">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}

      <Cartao titulo="Chaves de API">
        <div className="grid gap-4">
          <p className="text-sm text-suave">
            O CRM consulta <code>/v1/leads</code>, <code>/v1/unidades</code> e <code>/v1/empreendimentos</code> com o cabeçalho <code>Authorization: Bearer &lt;chave&gt;</code>.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Campo id="chave-nome" rotulo="Nome da chave" placeholder="RD Station" maxLength={80} value={nomeChave} onChange={(e) => setNomeChave(e.target.value)} />
            <Botao
              type="button"
              disabled={ocupado || !nomeChave.trim()}
              onClick={() =>
                rodar(
                  () => acoes.criarChave(nomeChave.trim()),
                  (r) => {
                    setChaveNova(r.chave);
                    setNomeChave('');
                  },
                )
              }
            >
              Criar chave
            </Botao>
          </div>
          {chaveNova && <UmaVez titulo="Chave criada." valor={chaveNova} testid="chave-nova" />}
          {dados.chaves.length > 0 && (
            <ul className="divide-y divide-borda text-sm" data-testid="lista-chaves">
              {dados.chaves.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="grid gap-0.5">
                    <strong>{c.nome}</strong>
                    <span className="text-xs text-suave">
                      <code>{c.prefixo}…</code> · criada em {data(c.criadoEm)} · último uso: {data(c.ultimoUso)}
                    </span>
                  </span>
                  {c.revogadaEm ? (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">Revogada</span>
                  ) : (
                    <button type="button" className="text-perigo underline" disabled={ocupado} onClick={() => rodar(() => acoes.revogarChave(c.id))}>
                      Revogar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Cartao>

      <Cartao titulo="Webhooks">
        <div className="grid gap-4">
          <p className="text-sm text-suave">
            O Imersa 3D avisa o seu CRM na hora (POST com JSON). Cada aviso vem assinado (<code>X-Imersa-Assinatura</code>); sem resposta 2xx, tenta de novo com espera crescente por até um dia.
          </p>
          <Campo id="webhook-url" rotulo="Endereço do CRM (https)" type="url" placeholder="https://crm.suaempresa.com.br/imersa" value={url} onChange={(e) => setUrl(e.target.value)} />
          <fieldset className="grid gap-2 text-sm">
            <legend className="mb-1 font-medium">Avisar quando</legend>
            {EVENTOS.map((ev) => (
              <label key={ev.id} className="flex min-h-10 items-center gap-2">
                <input type="checkbox" checked={eventos.includes(ev.id)} onChange={() => setEventos(eventos.includes(ev.id) ? eventos.filter((x) => x !== ev.id) : [...eventos, ev.id])} />
                {ev.rotulo}
              </label>
            ))}
          </fieldset>
          <Botao
            type="button"
            className="w-fit"
            disabled={ocupado || !url.trim() || eventos.length === 0}
            onClick={() =>
              rodar(
                () => acoes.criarWebhook(url.trim(), eventos),
                (r) => {
                  setSegredoNovo(r.segredo);
                  setUrl('');
                },
              )
            }
          >
            Cadastrar webhook
          </Botao>
          {segredoNovo && <UmaVez titulo="Webhook cadastrado. Segredo para conferir a assinatura:" valor={segredoNovo} testid="segredo-webhook" />}
          {dados.webhooks.length > 0 && (
            <ul className="divide-y divide-borda text-sm" data-testid="lista-webhooks">
              {dados.webhooks.map((w) => (
                <li key={w.id} className="grid gap-2 py-3">
                  <span className="break-all font-medium">{w.url}</span>
                  <span className="text-xs text-suave">
                    {w.eventos.map((e) => EVENTOS.find((x) => x.id === e)?.rotulo ?? e).join(' · ')} · {w.entregues} entregues · {w.pendentes} na fila · {w.falhas} falharam
                  </span>
                  <span className="flex gap-4">
                    <button type="button" className="underline" disabled={ocupado} onClick={() => rodar(() => acoes.testarWebhook(w.id), () => setAviso('Teste na fila: o aviso sai em até 15 s.'))}>
                      Enviar teste
                    </button>
                    <button type="button" className="text-perigo underline" disabled={ocupado} onClick={() => rodar(() => acoes.apagarWebhook(w.id))}>
                      Remover
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Cartao>
    </div>
  );
}
