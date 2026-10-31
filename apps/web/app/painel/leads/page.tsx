import Link from 'next/link';
import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, ROTULO_STATUS_LEAD, STATUS_LEAD, type Lead, type Me, type StatusLead } from '@/lib/tipos';
import { mudarStatusLead } from './actions';
import { ListaLeads } from './lista';

export default async function PaginaLeads({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const volta = '/painel/leads';
  const me = (await apiNaPagina<Me>('/me', volta)).dados;
  if (!ehGestao(me.papel) && me.papel !== 'consultora') return <Aviso>Os pedidos de contato ficam com a gestão e as consultoras.</Aviso>;
  const pedido = (await searchParams).status;
  const status = STATUS_LEAD.includes(pedido as StatusLead) ? (pedido as StatusLead) : null;
  const r = await apiNaPagina<Lead[]>(`/leads${status ? `?status=${status}` : ''}`, volta);
  if (r.status === 403) return <Aviso>Ative a verificação em duas etapas (Segurança) para ver os pedidos de contato: eles têm dados pessoais.</Aviso>;
  if (r.status !== 200) return <Aviso tipo="erro">Não foi possível carregar os pedidos agora.</Aviso>;
  const filtro = (s: StatusLead | null, rotulo: string) => (
    <Link
      key={s ?? 'todos'}
      href={s ? `/painel/leads?status=${s}` : '/painel/leads'}
      aria-current={status === s ? 'page' : undefined}
      className={`rounded-full border px-3 py-1 ${status === s ? 'border-acento bg-acento/10 font-semibold' : 'border-borda'}`}
    >
      {rotulo}
    </Link>
  );
  return (
    <>
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Leads</h1>
        <p className="text-sm text-suave">
          {ehGestao(me.papel) ? 'Pedidos de contato de todos os links da empresa.' : 'Pedidos de contato que chegaram pelos seus links.'} Cada um tem a autorização do cliente
          registrada (LGPD).
        </p>
      </div>
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filtrar por situação">
        {filtro(null, 'Todos')}
        {STATUS_LEAD.map((s) => filtro(s, ROTULO_STATUS_LEAD[s]))}
      </nav>
      <Cartao>
        <ListaLeads leads={r.dados} mudarStatus={mudarStatusLead} />
      </Cartao>
    </>
  );
}
