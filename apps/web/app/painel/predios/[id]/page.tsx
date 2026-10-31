import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Arquivo, type Espelho, type Me } from '@/lib/tipos';
import { mudarStatus, vincularModelo } from './actions';
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
  return (
    <>
      <div className="grid gap-1">
        <Link href={`/painel/projetos/${espelho.predio.projetoId}`} className="text-sm text-suave hover:underline">
          ← {espelho.predio.projetoNome}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{espelho.predio.nome}</h1>
          <Link href={`/painel/predios/${espelho.predio.id}/vitrine`} className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-acento-texto hover:opacity-90">
            Abrir Vitrine 3D
          </Link>
        </div>
      </div>
      <EspelhoVendas espelho={espelho} mudarStatus={mudarStatus.bind(null, espelho.predio.id)} />
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
