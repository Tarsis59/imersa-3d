import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type DetalheProjeto, type Me, type Numeros } from '@/lib/tipos';

const PERIODOS = [7, 30, 90] as const;
const duracao = (s: number | null) => (s === null ? '—' : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);
const pct = (n: number) => `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function Numero({ rotulo, valor, detalhe, testid }: { rotulo: string; valor: string; detalhe?: string; testid?: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-borda p-4">
      <span className="text-sm text-suave">{rotulo}</span>
      <strong data-testid={testid} className="text-2xl">
        {valor}
      </strong>
      {detalhe && <span className="text-xs text-suave">{detalhe}</span>}
    </div>
  );
}

export default async function PaginaNumeros({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dias?: string }> }) {
  const { id } = await params;
  const pedido = Number((await searchParams).dias);
  const dias = PERIODOS.includes(pedido as (typeof PERIODOS)[number]) ? pedido : 30;
  const volta = `/painel/projetos/${id}/numeros`;
  const me = (await apiNaPagina<Me>('/me', volta)).dados;
  if (!ehGestao(me.papel) && me.papel !== 'consultora') return <Aviso>Os números de vendas ficam com a gestão e as consultoras.</Aviso>;
  const [det, r] = await Promise.all([
    apiNaPagina<DetalheProjeto>(`/projetos/${encodeURIComponent(id)}`, volta),
    apiNaPagina<Numeros>(`/projetos/${encodeURIComponent(id)}/numeros?dias=${dias}`, volta),
  ]);
  if (det.status !== 200 || r.status === 404) notFound();
  if (r.status !== 200) return <Aviso tipo="erro">Não foi possível carregar os números agora.</Aviso>;
  const n = r.dados;
  return (
    <>
      <div className="grid gap-1">
        <Link href={`/painel/projetos/${id}`} className="text-sm text-suave hover:underline">
          ← {det.dados.projeto.nome}
        </Link>
        <h1 className="text-2xl font-bold">Números de vendas</h1>
        <p className="text-sm text-suave">
          Visitas pelos links enviados aos clientes nos últimos {n.dias} dias{ehGestao(me.papel) ? '' : ' (só os seus links)'}.
        </p>
      </div>
      <nav className="flex gap-2 text-sm" aria-label="Período">
        {PERIODOS.map((p) => (
          <Link key={p} href={`${volta}?dias=${p}`} aria-current={p === dias ? 'page' : undefined} className={`rounded-full border px-3 py-1 ${p === dias ? 'border-acento bg-acento/10 font-semibold' : 'border-borda'}`}>
            {p} dias
          </Link>
        ))}
      </nav>
      <Cartao>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Numero rotulo="Visitas" valor={String(n.visitas)} testid="numeros-visitas" />
          <Numero rotulo="Tempo médio de visita" valor={duracao(n.tempoMedioS)} />
          <Numero rotulo="Pedidos de contato" valor={String(n.leads)} testid="numeros-leads" />
          <Numero rotulo="Conversão" valor={pct(n.conversao)} detalhe="pedidos ÷ visitas" />
          <Numero rotulo="Abriram o interior real" valor={String(n.interiores)} />
          <Numero rotulo="Tours do lazer completos" valor={String(n.toursLazer)} testid="numeros-tours-lazer" />
        </div>
      </Cartao>
      <Cartao titulo="Unidades mais vistas">
        {n.unidades.length === 0 ? (
          <p className="text-sm text-suave">Ainda sem unidades vistas no período.</p>
        ) : (
          <table className="w-full text-left text-sm" data-testid="numeros-unidades">
            <thead className="text-suave">
              <tr>
                <th className="py-1 font-medium">Unidade</th>
                <th className="py-1 font-medium">Vistas</th>
                <th className="py-1 font-medium">Favoritadas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {n.unidades.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 font-semibold">{u.codigo}</td>
                  <td className="py-2">{u.vistas}</td>
                  <td className="py-2">{u.favoritos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Cartao>
      <Cartao titulo="Por consultora">
        {n.porConsultora.length === 0 ? (
          <p className="text-sm text-suave">Nenhum link gerado para este empreendimento ainda.</p>
        ) : (
          <table className="w-full text-left text-sm" data-testid="numeros-consultoras">
            <thead className="text-suave">
              <tr>
                <th className="py-1 font-medium">Consultora</th>
                <th className="py-1 font-medium">Links</th>
                <th className="py-1 font-medium">Visitas</th>
                <th className="py-1 font-medium">Pedidos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {n.porConsultora.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 font-semibold">{c.nome}</td>
                  <td className="py-2">{c.links}</td>
                  <td className="py-2">{c.visitas}</td>
                  <td className="py-2">{c.leads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Cartao>
    </>
  );
}
