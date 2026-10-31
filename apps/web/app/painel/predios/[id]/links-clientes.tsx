'use client';
import { useState, useTransition } from 'react';
import { Aviso, Botao, Campo, Selecao } from '@/components/ui';
import type { LinkCliente, StatusLink } from '@/lib/tipos';

const COR: Record<StatusLink, string> = {
  ativo: 'bg-emerald-100 text-emerald-900',
  vencido: 'bg-slate-200 text-slate-700',
  revogado: 'bg-red-100 text-red-900',
};
const ROTULO: Record<StatusLink, string> = { ativo: 'Ativo', vencido: 'Vencido', revogado: 'Desativado' };
const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export function LinksClientes({
  predioNome,
  projetoNome,
  links,
  criar,
  revogar,
}: {
  predioNome: string;
  projetoNome: string;
  links: LinkCliente[];
  criar: (titulo: string, dias: number) => Promise<{ url: string; expiraEm: string } | { erro: string }>;
  revogar: (linkId: string) => Promise<{ erro?: string }>;
}) {
  const [titulo, setTitulo] = useState('');
  const [dias, setDias] = useState('30');
  const [novo, setNovo] = useState<{ url: string; expiraEm: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  const texto = (url: string) => `Olá! Separei a visita em 3D do ${projetoNome} (${predioNome}) para você. Dá para ver as unidades, a vista e andar por dentro pelo celular: ${url}`;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-suave">Mande o link pelo WhatsApp: o cliente abre no celular, sem cadastro, e pode pedir contato. Cada visita e cada pedido aparecem aqui e em Leads.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        <Campo id="link-titulo" rotulo="Para quem (opcional)" placeholder="Família Souza" maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <Selecao id="link-dias" rotulo="Vale por" value={dias} onChange={(e) => setDias(e.target.value)}>
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="90">90 dias</option>
        </Selecao>
        <Botao
          type="button"
          disabled={ocupado}
          onClick={() =>
            iniciar(async () => {
              setErro(null);
              setCopiado(false);
              const r = await criar(titulo, Number(dias));
              if ('erro' in r) return setErro(r.erro);
              setNovo(r);
              setTitulo('');
            })
          }
        >
          Gerar link
        </Botao>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {novo && (
        <div className="grid gap-2 rounded-xl border border-acento/40 bg-acento/5 p-4 text-sm">
          <p className="font-medium">Link pronto (vale até {data(novo.expiraEm)}). Copie agora: por segurança ele não aparece de novo.</p>
          <code data-testid="link-cliente" className="break-all rounded bg-superficie px-2 py-1">
            {novo.url}
          </code>
          <div className="flex flex-wrap gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={async () => {
                await navigator.clipboard?.writeText(novo.url).catch(() => undefined);
                setCopiado(true);
              }}
            >
              {copiado ? 'Copiado ✓' : 'Copiar link'}
            </Botao>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(texto(novo.url))}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Enviar pelo WhatsApp
            </a>
          </div>
        </div>
      )}
      {links.length > 0 && (
        <ul className="divide-y divide-borda text-sm" data-testid="lista-links">
          {links.map((l) => (
            <li key={l.id} data-status-link={l.status} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="grid gap-0.5">
                <strong>{l.titulo ?? 'Sem nome'}</strong>
                <span className="text-xs text-suave">
                  {l.criadoPor.nome} · criado em {data(l.criadoEm)} · {l.status === 'ativo' ? `vale até ${data(l.expiraEm)}` : ROTULO[l.status].toLowerCase()}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-suave" data-testid="link-numeros">
                  {l.visitas} {l.visitas === 1 ? 'visita' : 'visitas'} · {l.leads} {l.leads === 1 ? 'pedido' : 'pedidos'}
                </span>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${COR[l.status]}`}>{ROTULO[l.status]}</span>
                {l.status === 'ativo' && (
                  <button
                    type="button"
                    className="text-perigo underline"
                    disabled={ocupado}
                    onClick={() =>
                      iniciar(async () => {
                        const r = await revogar(l.id);
                        if (r.erro) setErro(r.erro);
                      })
                    }
                  >
                    Desativar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
