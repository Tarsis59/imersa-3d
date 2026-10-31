import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { UnidadeViewer } from '@imersa/viewer';
import { Aviso } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Espelho, type Me } from '@/lib/tipos';
import type { ConfiguracaoDetalhe, ConfiguracaoResumo, Material, Movel } from '@/lib/configurador';
import { linkDoArquivo } from '../vitrine/actions';
import { apagarConfiguracao, salvarConfiguracao } from './actions';
import { Configurador } from './configurador';

export default async function PaginaConfigurador({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ configuracao?: string }> }) {
  const { id } = await params;
  const { configuracao } = await searchParams;
  const volta = `/painel/predios/${id}/configurador`;
  const [r, me] = await Promise.all([apiNaPagina<Espelho>(`/predios/${encodeURIComponent(id)}`, volta), apiNaPagina<Me>('/me', volta)]);
  if (r.status !== 200) notFound();
  const { predio, andares } = r.dados;
  const cabecalho = (
    <div className="grid gap-1">
      <Link href={`/painel/predios/${predio.id}`} className="text-sm text-suave hover:underline">
        ← {predio.nome}
      </Link>
      <h1 className="text-2xl font-bold">Configurador · {predio.nome}</h1>
      <p className="text-sm text-suave">Troque pisos, paredes, telhado e esquadrias, coloque móveis e gere o orçamento da combinação.</p>
    </div>
  );
  if (!(ehGestao(me.dados.papel) || me.dados.papel === 'consultora'))
    return (
      <>
        {cabecalho}
        <Aviso>O configurador é usado pela gestão e pelas consultoras, junto com a cliente.</Aviso>
      </>
    );
  if (!predio.modeloArquivoId)
    return (
      <>
        {cabecalho}
        <Aviso>Este prédio ainda não tem modelo 3D. Envie o projeto BIM (.ifc) ou um .glb no empreendimento e ligue-o ao prédio.</Aviso>
      </>
    );
  const [download, materiais, moveis, salvas, aberta] = await Promise.all([
    apiNaPagina<{ url: string }>(`/arquivos/${predio.modeloArquivoId}/download`, volta),
    apiNaPagina<Material[]>('/materiais', volta),
    apiNaPagina<Movel[]>('/moveis', volta),
    apiNaPagina<ConfiguracaoResumo[]>(`/predios/${encodeURIComponent(id)}/configuracoes`, volta),
    configuracao ? apiNaPagina<ConfiguracaoDetalhe>(`/configuracoes/${encodeURIComponent(configuracao)}`, volta) : null,
  ]);
  if (download.status !== 200) return <Aviso tipo="erro">Não foi possível abrir o modelo 3D agora.</Aviso>;
  const unidades: UnidadeViewer[] = andares.flatMap((a) =>
    a.unidades.map((u) => ({ id: u.id, codigo: u.codigo, andar: a.numero, status: u.status, areaM2: u.areaM2, quartos: u.quartos, preco: u.preco, meshNodeId: u.meshNodeId })),
  );
  return (
    <>
      {cabecalho}
      {materiais.dados.length === 0 && (
        <Aviso>
          O catálogo de acabamentos está vazio.{' '}
          {ehGestao(me.dados.papel) ? (
            <Link href="/painel/catalogo" className="font-semibold underline">
              Abrir o catálogo
            </Link>
          ) : (
            'Peça à gestão para cadastrar os materiais.'
          )}
        </Aviso>
      )}
      <Configurador
        key={aberta?.status === 200 ? aberta.dados.id : 'nova'}
        predioId={predio.id}
        modeloUrl={download.dados.url}
        unidades={unidades}
        materiais={materiais.dados}
        moveis={moveis.dados}
        salvas={salvas.status === 200 ? salvas.dados : []}
        aberta={aberta?.status === 200 ? aberta.dados : null}
        salvar={salvarConfiguracao.bind(null, predio.id)}
        apagar={apagarConfiguracao.bind(null, predio.id)}
        linkDoArquivo={linkDoArquivo}
      />
    </>
  );
}
