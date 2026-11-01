import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Arquivo, type Espelho, type Estande, type GirosDoPredio, type LinkCliente, type Me, type VideosDoPredio } from '@/lib/tipos';
import { comandarEstande, criarEstande, criarLink, mudarStatus, pedirGiro, pedirVideo, revogarLink, vincularModelo } from './actions';
import { linkDoArquivo } from './vitrine/actions';
import { Estudio } from './estudio';
import { Estandes } from './estandes';
import { GiroRenderizado } from './giro-renderizado';
import { LinksClientes } from './links-clientes';
import { EspelhoVendas } from './espelho';
import { ModeloDoPredio } from './modelo-3d';

export default async function PaginaPredio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const volta = `/painel/predios/${id}`;
  // independentes entre si: em paralelo (cada ida à API grátis custa centenas de ms)
  const [r, eu, lGiros, lVideos] = await Promise.all([
    apiNaPagina<Espelho>(`/predios/${encodeURIComponent(id)}`, volta),
    apiNaPagina<Me>('/me', volta),
    apiNaPagina<GirosDoPredio>(`/predios/${encodeURIComponent(id)}/giros`, volta),
    apiNaPagina<VideosDoPredio>(`/predios/${encodeURIComponent(id)}/videos`, volta),
  ]);
  if (r.status !== 200) notFound();
  const espelho = r.dados;
  const me = eu.dados;
  const giros = lGiros.dados;
  const videos = lVideos.dados;
  // gestão e consultoras geram links para clientes (cada consultora vê só os dela)
  const podeLinks = ehGestao(me.papel) || me.papel === 'consultora';
  // estande: link público que fica anos ligado num PC; só a gestão, com verificação em duas etapas
  const podeEstande = ehGestao(me.papel) && me.mfa;
  const [lArquivos, lLinks, lEstandes] = await Promise.all([
    apiNaPagina<Arquivo[]>(`/projetos/${espelho.predio.projetoId}/arquivos`, volta),
    podeLinks ? apiNaPagina<LinkCliente[]>(`/predios/${encodeURIComponent(id)}/links`, volta) : null,
    podeEstande ? apiNaPagina<Estande[]>(`/predios/${encodeURIComponent(id)}/estandes`, volta) : null,
  ]);
  const arquivos = lArquivos.dados;
  const modelos = arquivos.filter((a) => a.tipo === 'modelo_3d' && a.status === 'pronto');
  const links = lLinks?.dados ?? [];
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
      {podeEstande && (
        <Cartao titulo="Estande de vendas (tela touch)">
          <Estandes
            predioId={espelho.predio.id}
            estandes={lEstandes?.dados ?? []}
            temModelo={Boolean(espelho.predio.modeloArquivoId)}
            criar={criarEstande.bind(null, espelho.predio.id)}
            comandar={comandarEstande.bind(null, espelho.predio.id)}
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
      <Cartao titulo="Estúdio de marketing (vídeos)">
        <Estudio dados={videos} podePedir={ehGestao(me.papel) && me.mfa} pedir={pedirVideo.bind(null, espelho.predio.id)} linkDoArquivo={linkDoArquivo} />
      </Cartao>
      <Cartao titulo="Giro 360° fotorrealista">
        <GiroRenderizado giros={giros} podePedir={ehGestao(me.papel) && me.mfa} pedir={pedirGiro.bind(null, espelho.predio.id)} />
      </Cartao>
    </>
  );
}
