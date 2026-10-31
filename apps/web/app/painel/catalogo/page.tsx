import { Aviso } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Arquivo, type Me, type Projeto } from '@/lib/tipos';
import type { Material, Movel } from '@/lib/configurador';
import { alterarMaterial, alterarMovel, catalogoInicial, criarMaterial, criarMovel } from './actions';
import { Catalogo } from './catalogo';

export default async function PaginaCatalogo() {
  const volta = '/painel/catalogo';
  const me = (await apiNaPagina<Me>('/me', volta)).dados;
  const gestao = ehGestao(me.papel);
  const sufixo = gestao ? '?todos=1' : '';
  const [materiais, moveis, projetos] = await Promise.all([
    apiNaPagina<Material[]>(`/materiais${sufixo}`, volta),
    apiNaPagina<Movel[]>(`/moveis${sufixo}`, volta),
    gestao ? apiNaPagina<Projeto[]>('/projetos', volta) : null,
  ]);
  if (materiais.status !== 200 || moveis.status !== 200) return <Aviso tipo="erro">Não foi possível carregar o catálogo agora.</Aviso>;
  // GLBs já verificados de qualquer empreendimento podem virar móvel do catálogo
  const glbs = projetos?.status === 200
    ? (
        await Promise.all(
          projetos.dados.map(async (p) => {
            const r = await apiNaPagina<Arquivo[]>(`/projetos/${encodeURIComponent(p.id)}/arquivos`, volta);
            return r.status === 200 ? r.dados.filter((a) => a.tipo === 'modelo_3d' && a.status === 'pronto').map((a) => ({ id: a.id, nome: `${a.nome} (${p.nome})` })) : [];
          }),
        )
      ).flat()
    : [];
  return (
    <>
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Catálogo de acabamentos e móveis</h1>
        <p className="text-sm text-suave">
          O que a cliente pode escolher no configurador 3D, com o preço que vai para o orçamento. Itens desativados somem do configurador, mas
          continuam nas combinações já salvas.
        </p>
      </div>
      {!gestao && <Aviso>Só a gestão altera o catálogo e os preços.</Aviso>}
      <Catalogo
        materiais={materiais.dados}
        moveis={moveis.dados}
        glbs={glbs}
        podeEditar={gestao}
        acoes={{ criarMaterial, alterarMaterial, catalogoInicial, criarMovel, alterarMovel }}
      />
    </>
  );
}
