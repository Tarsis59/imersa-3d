'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Botao, Campo } from '@/components/ui';
import { useAtualizarEnquanto } from '@/lib/atualizacao';
import { ROTULO_ETAPA, type EstadoEtapa, type Montagem } from '@/lib/tipos';
import { iniciarMontagem } from '../../../criar/actions';

const ICONE: Record<EstadoEtapa, string> = { pendente: '○', rodando: '◌', feita: '✔', pulada: '–', aviso: '!', falhou: '✕' };
const COR: Record<EstadoEtapa, string> = {
  pendente: 'text-suave',
  rodando: 'text-acento animate-pulse',
  feita: 'text-sucesso',
  pulada: 'text-suave',
  aviso: 'text-amber-600',
  falhou: 'text-perigo',
};
const ROTULO_ESTADO: Record<EstadoEtapa, string> = { pendente: 'esperando', rodando: 'rodando', feita: 'feita', pulada: 'não precisou', aviso: 'com aviso', falhou: 'falhou' };

/** Painel ao vivo da montagem (Plano 11a, item 4): o que está acontecendo, o que falta e o que precisa da pessoa. */
export function PainelMontagem({ montagem: m }: { montagem: Montagem }) {
  const router = useRouter();
  const montando = m.estado === 'montando' || m.estado === 'aguardando_arquivos';
  useAtualizarEnquanto(montando, 1500);
  const [cep, setCep] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const local = m.etapas.find((e) => e.id === 'local');
  const pronta = m.estado === 'pronta' || m.estado === 'pronta_com_avisos';
  const feitas = m.etapas.filter((e) => e.estado !== 'pendente' && e.estado !== 'rodando').length;
  const totalMs = m.iniciadaEm && m.concluidaEm ? new Date(m.concluidaEm).getTime() - new Date(m.iniciadaEm).getTime() : null;

  const retomar = (corpo: { cep?: string | null }) =>
    iniciar(async () => {
      setErro(null);
      const r = await iniciarMontagem(m.id, corpo);
      if (r.erro) setErro(r.erro);
      router.refresh();
    });

  return (
    <div className="grid gap-6" data-testid="montagem" data-estado={m.estado}>
      <section className="rounded-2xl border border-borda bg-superficie p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{pronta ? (m.estado === 'pronta' ? 'Pronto!' : 'Pronto, com avisos') : m.estado === 'falhou' ? 'Não deu para montar' : 'Montando...'}</h2>
          <span className="text-sm text-suave">
            {feitas} de {m.etapas.length || 7} etapas{totalMs !== null ? ` · ${(totalMs / 1000).toFixed(1)} s` : ''}
          </span>
        </div>
        <div className="mb-5 h-2 overflow-hidden rounded-full bg-borda" role="progressbar" aria-label="Andamento da montagem" aria-valuemin={0} aria-valuemax={m.etapas.length || 7} aria-valuenow={feitas}>
          <div className="h-full bg-acento transition-all" style={{ width: `${(feitas / (m.etapas.length || 7)) * 100}%` }} />
        </div>
        <ol className="grid gap-3" aria-live="polite">
          {m.etapas.map((e) => (
            <li key={e.id} className="grid grid-cols-[1.5rem_1fr] gap-2" data-testid={`etapa-${e.id}`} data-estado={e.estado}>
              <span className={`text-center font-bold ${COR[e.estado]}`} aria-hidden>
                {ICONE[e.estado]}
              </span>
              <div>
                <p className="text-sm font-medium">
                  {ROTULO_ETAPA[e.id]} <span className="font-normal text-suave">· {ROTULO_ESTADO[e.estado]}</span>
                </p>
                {e.detalhe && <p className="text-sm text-suave">{e.detalhe}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {local?.estado === 'aviso' && !montando && (
        <section className="rounded-2xl border border-borda bg-superficie p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-semibold">Falta o lugar</h2>
          <p className="mb-3 text-sm text-suave">Com o CEP eu acho o endereço, monto a cidade em volta e busco escolas, mercados e transporte perto.</p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{5}-?\d{3}$/.test(cep.trim())) retomar({ cep: cep.trim() });
              else setErro('Digite o CEP com 8 números.');
            }}
          >
            <div className="w-40">
              <Campo id="montagem-cep" rotulo="CEP" inputMode="numeric" placeholder="00000-000" value={cep} maxLength={9} onChange={(e) => setCep(e.target.value.replace(/[^\d-]/g, ''))} />
            </div>
            <Botao type="submit" disabled={pendente}>
              Achar e retomar
            </Botao>
          </form>
          <p className="mt-3 text-xs text-suave">
            Ou marque o ponto no mapa em{' '}
            <Link href={`/painel/projetos/${m.projetoId}`} className="underline">
              localização do empreendimento
            </Link>{' '}
            e retome aqui.
          </p>
        </section>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {pronta && m.predioId && (
        <section className="grid gap-3 rounded-2xl border border-acento/40 bg-acento/5 p-6">
          <h2 className="text-lg font-semibold">O que fazer agora</h2>
          <div className="flex flex-wrap gap-3">
            <Link href={`/painel/predios/${m.predioId}/vitrine`} className="inline-flex min-h-12 items-center rounded-lg bg-acento px-6 text-base font-semibold text-acento-texto" data-testid="abrir-vitrine">
              Abrir a Vitrine 3D
            </Link>
            <Link href={`/painel/predios/${m.predioId}`} className="inline-flex min-h-12 items-center rounded-lg border border-borda bg-superficie px-4 text-sm font-semibold">
              Unidades e preços
            </Link>
            <Link href={`/painel/projetos/${m.projetoId}`} className="inline-flex min-h-12 items-center rounded-lg border border-borda bg-superficie px-4 text-sm font-semibold">
              Arquivos e localização
            </Link>
          </div>
          <p className="text-xs text-suave">Os preços e a situação de cada unidade entram pela tela de unidades ou pela planilha. O lazer pode ser arrastado no 3D.</p>
        </section>
      )}
      {m.estado === 'falhou' && (
        <div className="flex flex-wrap gap-3">
          <Botao type="button" onClick={() => retomar({})} disabled={pendente}>
            Tentar de novo
          </Botao>
          <Link href="/painel/criar" className="inline-flex min-h-10 items-center rounded-lg border border-borda bg-superficie px-4 text-sm font-semibold">
            Começar outro
          </Link>
        </div>
      )}
    </div>
  );
}
