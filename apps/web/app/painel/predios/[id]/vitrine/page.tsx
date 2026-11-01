import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { UnidadeViewer } from '@imersa/viewer';
import { apiNaPagina } from '@/lib/sessao';
import type { Arquivo, DetalheProjeto, Espelho, GirosDoPredio, Me } from '@/lib/tipos';
import { Vitrine } from './vitrine';
import { bilheteAoVivo, carregarEntorno, linkDoArquivo } from './actions';

const NIVEIS_FIXOS = ['alto', 'medio', 'baixo'] as const;

export default async function PaginaVitrine({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ qualidade?: string }> }) {
  const { id } = await params;
  // ?qualidade=alto|medio|baixo fixa o nível (testes visuais, comparação entre aparelhos)
  const fixa = NIVEIS_FIXOS.indexOf((await searchParams).qualidade as (typeof NIVEIS_FIXOS)[number]);
  const volta = `/painel/predios/${id}/vitrine`;
  const r = await apiNaPagina<Espelho>(`/predios/${encodeURIComponent(id)}`, volta);
  if (r.status !== 200) notFound();
  const { predio, andares } = r.dados;
  // independentes entre si: em paralelo (cada ida à API custa uma volta de rede)
  const [detalhe, lista, download, me, giros] = await Promise.all([
    apiNaPagina<DetalheProjeto>(`/projetos/${encodeURIComponent(predio.projetoId)}`, volta),
    apiNaPagina<Arquivo[]>(`/projetos/${encodeURIComponent(predio.projetoId)}/arquivos`, volta),
    predio.modeloArquivoId ? apiNaPagina<{ url: string }>(`/arquivos/${predio.modeloArquivoId}/download`, volta) : null,
    apiNaPagina<Me>('/me', volta),
    apiNaPagina<GirosDoPredio>(`/predios/${encodeURIComponent(id)}/giros`, volta),
  ]);
  const empresa = me.dados.empresas.find((e) => e.id === me.dados.tenantId)?.nome ?? '';
  const projeto = detalhe.dados.projeto;
  const modeloUrl = download?.status === 200 ? download.dados.url : null;
  const interiores = lista.dados.filter((a) => a.tipo === 'splat' && a.status === 'pronto').map((a) => ({ id: a.id, nome: a.nome }));
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
        projetoId={predio.projetoId}
        predioNome={predio.nome}
        empresa={empresa}
        chaveModelo={predio.modeloArquivoId ?? 'volumes'}
        modeloUrl={modeloUrl}
        unidades={unidades}
        andares={andares.map((a) => ({ numero: a.numero, nome: a.nome }))}
        rotacaoGraus={projeto.rotacaoGraus}
        lat={projeto.lat}
        lon={projeto.lon}
        interiores={interiores}
        giroRenderizado={giros.status === 200 ? giros.dados.vitrine : null}
        qualidadeFixa={fixa >= 0 ? fixa : null}
        carregarEntorno={carregarEntorno.bind(null, predio.projetoId)}
        linkDoArquivo={linkDoArquivo}
        aoVivo={bilheteAoVivo.bind(null, predio.id)}
      />
    </>
  );
}
