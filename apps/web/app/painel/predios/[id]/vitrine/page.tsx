import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { UnidadeViewer } from '@imersa/viewer';
import { apiNaPagina } from '@/lib/sessao';
import type { DetalheProjeto, Espelho } from '@/lib/tipos';
import { Vitrine } from './vitrine';

export default async function PaginaVitrine({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const volta = `/painel/predios/${id}/vitrine`;
  const r = await apiNaPagina<Espelho>(`/predios/${encodeURIComponent(id)}`, volta);
  if (r.status !== 200) notFound();
  const { predio, andares } = r.dados;
  const projeto = (await apiNaPagina<DetalheProjeto>(`/projetos/${encodeURIComponent(predio.projetoId)}`, volta)).dados.projeto;
  let modeloUrl: string | null = null;
  if (predio.modeloArquivoId) {
    const download = await apiNaPagina<{ url: string }>(`/arquivos/${predio.modeloArquivoId}/download`, volta);
    if (download.status === 200) modeloUrl = download.dados.url;
  }
  const unidades: UnidadeViewer[] = andares.flatMap((a) =>
    a.unidades.map((u) => ({ id: u.id, codigo: u.codigo, andar: a.numero, status: u.status, areaM2: u.areaM2, quartos: u.quartos, preco: u.preco, meshNodeId: u.meshNodeId })),
  );
  return (
    <>
      <div className="grid gap-1">
        <Link href={`/painel/predios/${predio.id}`} className="text-sm text-suave hover:underline">
          ← {predio.nome}
        </Link>
        <h1 className="text-2xl font-bold">Vitrine 3D · {predio.nome}</h1>
        <p className="text-sm text-suave">
          {modeloUrl
            ? 'Modelo 3D do prédio; as peças ligadas às unidades aparecem na cor do status.'
            : 'Este prédio ainda não tem modelo 3D: as unidades aparecem como volumes por andar.'}
        </p>
      </div>
      <Vitrine
        predioId={predio.id}
        chaveModelo={predio.modeloArquivoId ?? 'volumes'}
        modeloUrl={modeloUrl}
        unidades={unidades}
        andares={andares.map((a) => ({ numero: a.numero, nome: a.nome }))}
        rotacaoGraus={projeto.rotacaoGraus}
        lat={projeto.lat}
        lon={projeto.lon}
      />
    </>
  );
}
