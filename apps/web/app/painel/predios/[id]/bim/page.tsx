import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import type { Espelho } from '@/lib/tipos';
import { salvarVinculos } from './actions';
import { Vinculos, type DadosVinculo } from './vinculos';

export default async function PaginaVinculoBim({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ conversao?: string }> }) {
  const { id } = await params;
  const conversao = (await searchParams).conversao ?? '';
  const volta = `/painel/predios/${id}/bim?conversao=${encodeURIComponent(conversao)}`;
  const e = await apiNaPagina<Espelho>(`/predios/${encodeURIComponent(id)}`, volta);
  if (e.status !== 200 || !/^[0-9a-f-]{36}$/i.test(conversao)) notFound();
  const r = await apiNaPagina<DadosVinculo>(`/predios/${encodeURIComponent(id)}/vinculos-bim?conversaoId=${conversao}`, volta);
  const { predio } = e.dados;
  return (
    <>
      <div className="grid gap-1">
        <Link href={`/painel/projetos/${predio.projetoId}`} className="text-sm text-suave hover:underline">
          ← {predio.projetoNome}
        </Link>
        <h1 className="text-2xl font-bold">Vincular ambientes do BIM · {predio.nome}</h1>
        <p className="text-sm text-suave">Cada unidade do espelho de vendas fica ligada a um ambiente do projeto: na Vitrine 3D ele acende na cor do status. Ambientes sem unidade ficam invisíveis.</p>
      </div>
      {r.status === 403 ? (
        <Aviso>Só a gestão (com verificação em duas etapas) vincula o projeto BIM.</Aviso>
      ) : r.status !== 200 ? (
        <Aviso tipo="erro">A conversão não está pronta ou não pertence a este empreendimento.</Aviso>
      ) : (
        <Cartao>
          <Vinculos predioId={predio.id} dados={r.dados} salvar={salvarVinculos.bind(null, predio.id, conversao)} />
        </Cartao>
      )}
    </>
  );
}
