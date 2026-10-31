import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiNaPagina } from '@/lib/sessao';
import type { Me } from '@/lib/tipos';
import { m2, reais, type ConfiguracaoDetalhe } from '@/lib/configurador';
import { Imprimir } from './imprimir';

/** Orçamento da combinação, pronto para imprimir ou salvar em PDF (pelo próprio navegador). */
export default async function PaginaOrcamento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const volta = `/painel/configuracoes/${id}`;
  const [r, me] = await Promise.all([apiNaPagina<ConfiguracaoDetalhe>(`/configuracoes/${encodeURIComponent(id)}`, volta), apiNaPagina<Me>('/me', volta)]);
  if (r.status !== 200) notFound();
  const c = r.dados;
  const empresa = me.dados.empresas.find((e) => e.id === me.dados.tenantId)?.nome ?? '';
  const data = new Date(c.atualizadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return (
    <article className="grid gap-5 rounded-2xl border border-borda bg-superficie p-6 print:border-0 print:p-0" data-testid="orcamento">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link href={`/painel/predios/${c.predioId}/configurador?configuracao=${c.id}`} className="text-sm text-suave hover:underline">
          ← Voltar ao configurador
        </Link>
        <Imprimir />
      </div>
      <header className="grid gap-1">
        <p className="text-sm text-suave">{empresa}</p>
        <h1 className="text-2xl font-bold">Orçamento de personalização</h1>
        <p className="text-sm">
          {c.projetoNome} · {c.predioNome}
          {c.unidadeCodigo ? ` · unidade ${c.unidadeCodigo}` : ''}
        </p>
        <p className="text-sm text-suave">
          {c.nome}
          {c.cliente ? ` · ${c.cliente}` : ''} · {data}
          {c.criadoPor ? ` · atendimento: ${c.criadoPor.nome}` : ''}
        </p>
      </header>
      <table className="w-full text-sm">
        <thead className="border-b border-borda text-left text-xs text-suave">
          <tr>
            <th className="py-2 pr-2 font-medium">Item</th>
            <th className="py-2 pr-2 text-right font-medium">Quantidade</th>
            <th className="py-2 pr-2 text-right font-medium">Preço</th>
            <th className="py-2 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {c.orcamento.linhas.map((l, i) => (
            <tr key={i}>
              <td className="py-2 pr-2">
                {l.item}
                <span className="block text-xs text-suave">{l.descricao}</span>
              </td>
              <td className="py-2 pr-2 text-right">{l.unidade === 'm²' ? m2(l.quantidade) : `${l.quantidade} un`}</td>
              <td className="py-2 pr-2 text-right">{l.precoUnitario === null ? 'sem preço' : `${reais(l.precoUnitario)}${l.unidade === 'm²' ? '/m²' : ''}`}</td>
              <td className="py-2 text-right">{l.precoUnitario === null ? '—' : reais(l.valor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-borda text-base font-bold">
            <td className="pt-3" colSpan={3}>
              Total
            </td>
            <td className="pt-3 text-right" data-testid="orcamento-total">
              {reais(c.orcamento.total)}
            </td>
          </tr>
        </tfoot>
      </table>
      <footer className="grid gap-1 text-xs text-suave">
        {c.orcamento.semPreco > 0 && (
          <p>
            {c.orcamento.semPreco} {c.orcamento.semPreco === 1 ? 'item está' : 'itens estão'} sem preço no catálogo e {c.orcamento.semPreco === 1 ? 'ficou' : 'ficaram'} fora do
            total.
          </p>
        )}
        <p>Áreas medidas no modelo 3D do empreendimento; valores sujeitos a confirmação no memorial descritivo e em visita técnica. Imagens ilustrativas.</p>
      </footer>
    </article>
  );
}
