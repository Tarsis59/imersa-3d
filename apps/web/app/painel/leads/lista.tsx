'use client';
import { useState, useTransition } from 'react';
import { Aviso } from '@/components/ui';
import { ROTULO_STATUS_LEAD, STATUS_LEAD, type Lead, type StatusLead } from '@/lib/tipos';

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
/** WhatsApp precisa do número com o país; telefones brasileiros sem o 55 ganham o código. */
function linkWhatsapp(telefone: string): string | null {
  const d = telefone.replace(/\D/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

export function ListaLeads({ leads, mudarStatus }: { leads: Lead[]; mudarStatus: (id: string, status: StatusLead) => Promise<{ erro?: string }> }) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  if (!leads.length) return <p className="text-suave">Nenhum pedido de contato ainda. Gere um link na página do prédio e mande para o cliente.</p>;
  return (
    <div className="grid gap-3">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <ul className="divide-y divide-borda" data-testid="lista-leads">
        {leads.map((l) => {
          const zap = l.telefone ? linkWhatsapp(l.telefone) : null;
          return (
            <li key={l.id} data-status-lead={l.status} className="grid gap-2 py-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="grid gap-0.5">
                  <strong className="text-base">{l.nome}</strong>
                  <span className="text-xs text-suave">
                    {quando(l.criadoEm)} · {l.projeto} · {l.predio}
                    {l.unidade ? ` · unidade ${l.unidade}` : ''} · link de {l.consultora}
                    {l.link ? ` (${l.link})` : ''}
                  </span>
                </span>
                <label className="flex items-center gap-2">
                  <span className="sr-only">Situação de {l.nome}</span>
                  <select
                    className="rounded-lg border border-borda bg-superficie px-2 py-1"
                    value={l.status}
                    disabled={ocupado}
                    onChange={(e) =>
                      iniciar(async () => {
                        setErro(null);
                        const r = await mudarStatus(l.id, e.target.value as StatusLead);
                        if (r.erro) setErro(r.erro);
                      })
                    }
                  >
                    {STATUS_LEAD.map((s) => (
                      <option key={s} value={s}>
                        {ROTULO_STATUS_LEAD[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {l.mensagem && <p className="whitespace-pre-line rounded-lg bg-fundo px-3 py-2">{l.mensagem}</p>}
              <div className="flex flex-wrap gap-4">
                {l.telefone && (
                  <a className="underline" href={`tel:${l.telefone.replace(/[^\d+]/g, '')}`}>
                    {l.telefone}
                  </a>
                )}
                {zap && (
                  <a className="font-medium text-emerald-700 underline" href={zap} target="_blank" rel="noreferrer">
                    WhatsApp
                  </a>
                )}
                {l.email && (
                  <a className="underline" href={`mailto:${l.email}`}>
                    {l.email}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
