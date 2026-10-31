import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiNaPagina } from '@/lib/sessao';
import type { Espelho } from '@/lib/tipos';
import { mudarStatus } from './actions';
import { EspelhoVendas } from './espelho';

export default async function PaginaPredio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await apiNaPagina<Espelho>(`/predios/${encodeURIComponent(id)}`, `/painel/predios/${id}`);
  if (r.status !== 200) notFound();
  const espelho = r.dados;
  return (
    <>
      <div className="grid gap-1">
        <Link href={`/painel/projetos/${espelho.predio.projetoId}`} className="text-sm text-suave hover:underline">
          ← {espelho.predio.projetoNome}
        </Link>
        <h1 className="text-2xl font-bold">{espelho.predio.nome}</h1>
      </div>
      <EspelhoVendas espelho={espelho} mudarStatus={mudarStatus.bind(null, espelho.predio.id)} />
    </>
  );
}
