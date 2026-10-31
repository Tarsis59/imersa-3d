import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Arquivo, type Espelho, type LinkCliente, type Me } from '@/lib/tipos';
import { criarLink, mudarStatus, revogarLink, vincularModelo } from './actions';
import { LinksClientes } from './links-clientes';
import { EspelhoVendas } from './espelho';
import { ModeloDoPredio } from './modelo-3d';

export default async function PaginaPredio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const volta = `/painel/predios/${id}`;
  const r = await apiNaPagina<Espelho>(`/predios/${encodeURIComponent(id)}`, volta);
  if (r.status !== 200) notFound();
  const espelho = r.dados;
  const me = (await apiNaPagina<Me>('/me', volta)).dados;
  const arquivos = (await apiNaPagina<Arquivo[]>(`/projetos/${espelho.predio.projetoId}/arquivos`, volta)).dados;
  const modelos = arquivos.filter((a) => a.tipo === 'modelo_3d' && a.status === 'pronto');
  // gestão e consultoras geram links para clientes (cada consultora vê só os dela)
  const podeLinks = ehGestao(me.papel) || me.papel === 'consultora';
  const links = podeLinks ? (await apiNaPagina<LinkCliente[]>(`/predios/${encodeURIComponent(id)}/links`, volta)).dados : [];
  return (
    <>
      <div className="grid gap-1">
        <Link href={`/painel/projetos/${espelho.predio.projetoId}`} className="text-sm text-suave hover:underline">
          ← {espelho.predio.projetoNome}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{espelho.predio.nome}</h1>
          <span className="flex flex-wrap gap-2">
            {podeLinks && espelho.predio.modeloArquivoId && (
              <Link href={`/painel/predios/${espelho.predio.id}/configurador`} className="rounded-lg border border-borda bg-superficie px-4 py-2 text-sm font-semibold hover:bg-fundo">
                Configurador
              </Link>
            )}
            <Link href={`/painel/predios/${espelho.predio.id}/vitrine`} className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-acento-texto hover:opacity-90">
              Abrir Vitrine 3D
            </Link>
          </span>
        </div>
      </div>
      <EspelhoVendas espelho={espelho} mudarStatus={mudarStatus.bind(null, espelho.predio.id)} />
      {podeLinks && (
        <Cartao titulo="Links para clientes">
          <LinksClientes
            predioNome={espelho.predio.nome}
            projetoNome={espelho.predio.projetoNome}
            links={links}
            criar={criarLink.bind(null, espelho.predio.id)}
            revogar={revogarLink.bind(null, espelho.predio.id)}
          />
        </Cartao>
      )}
      <Cartao titulo="Modelo 3D">
        <ModeloDoPredio
          predioId={espelho.predio.id}
          modeloAtual={espelho.predio.modeloArquivoId}
          modelos={modelos}
          podeEditar={ehGestao(me.papel) && me.mfa}
          acao={vincularModelo.bind(null, espelho.predio.id)}
        />
      </Cartao>
    </>
  );
}
