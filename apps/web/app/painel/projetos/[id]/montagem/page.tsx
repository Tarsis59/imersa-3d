import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiNaPagina } from '@/lib/sessao';
import type { Montagem } from '@/lib/tipos';
import { PainelMontagem } from './painel';

export const metadata = { title: 'Montagem · Imersa 3D' };

export default async function PaginaMontagem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await apiNaPagina<Montagem>(`/projetos/${id}/montagem`, `/painel/projetos/${id}/montagem`);
  if (r.status !== 200) notFound();
  return (
    <>
      <div>
        <Link href={`/painel/projetos/${id}`} className="text-sm text-suave hover:underline">
          ← Empreendimento
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Montando o empreendimento</h1>
      </div>
      <PainelMontagem montagem={r.dados} />
    </>
  );
}
