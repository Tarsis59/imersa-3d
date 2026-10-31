import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Espelho, type Me } from '@/lib/tipos';
import { vincularPeca } from '../actions';
import { Visualizador3D } from './visualizador';

export default async function PaginaVinculo3D({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const volta = `/painel/predios/${id}/3d`;
  const r = await apiNaPagina<Espelho>(`/predios/${encodeURIComponent(id)}`, volta);
  if (r.status !== 200) notFound();
  const { predio, andares } = r.dados;
  const me = (await apiNaPagina<Me>('/me', volta)).dados;
  const cabecalho = (
    <div className="grid gap-1">
      <Link href={`/painel/predios/${predio.id}`} className="text-sm text-suave hover:underline">
        ← {predio.nome}
      </Link>
      <h1 className="text-2xl font-bold">{predio.nome} em 3D</h1>
    </div>
  );
  if (!predio.modeloArquivoId) {
    return (
      <>
        {cabecalho}
        <Aviso>Este prédio ainda não tem modelo 3D. Ligue um na página do prédio.</Aviso>
      </>
    );
  }
  const download = await apiNaPagina<{ url: string }>(`/arquivos/${predio.modeloArquivoId}/download`, volta);
  if (download.status !== 200) notFound();
  const unidades = andares.flatMap((a) => a.unidades.map((u) => ({ id: u.id, codigo: u.codigo, andar: a.nome, status: u.status, meshNodeId: u.meshNodeId })));
  return (
    <>
      {cabecalho}
      <p className="text-sm text-suave">Arraste para girar, role para aproximar. Clique numa peça e escolha a unidade. Peças ligadas aparecem na cor do status.</p>
      <Visualizador3D modeloId={predio.modeloArquivoId} urlModelo={download.dados.url} unidades={unidades} podeEditar={ehGestao(me.papel) && me.mfa} vincular={vincularPeca.bind(null, predio.id)} />
    </>
  );
}
