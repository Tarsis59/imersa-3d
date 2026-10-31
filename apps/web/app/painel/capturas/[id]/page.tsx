import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, ROTULO_STATUS_CAPTURA, type Captura, type Me } from '@/lib/tipos';
import { Revisao } from './revisao';

const numero = (n: number | undefined, casas = 0) => (n === undefined ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: casas }));

export default async function PaginaCaptura({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const volta = `/painel/capturas/${id}`;
  const r = await apiNaPagina<Captura>(`/capturas/${encodeURIComponent(id)}`, volta);
  if (r.status !== 200) notFound();
  const c = r.dados;
  const me = (await apiNaPagina<Me>('/me', volta)).dados;
  const podeRevisar = ehGestao(me.papel) && me.mfa;
  const m = c.metricas;
  return (
    <>
      <div className="grid gap-1">
        <Link href={`/painel/projetos/${c.projetoId}`} className="text-sm text-suave hover:underline">
          ← Projeto
        </Link>
        <h1 className="text-2xl font-bold">{c.nome}</h1>
        <p className="text-sm text-suave" data-testid="status-captura">
          {ROTULO_STATUS_CAPTURA[c.status]} · {c.origem === 'fotos' ? 'fotos' : 'vídeo'} ({c.arquivoNome})
        </p>
      </div>
      {!podeRevisar && <Aviso>Só a gestão da empresa (com verificação em duas etapas) revisa e publica o 3D.</Aviso>}
      {podeRevisar && ['revisao', 'publicado'].includes(c.status) && <Revisao projetoId={c.projetoId} captura={c} />}
      <Cartao titulo="Como ficou">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-suave">Fotos usadas</dt>
          <dd>{m.registradas !== undefined ? `${m.registradas} de ${m.fotos}` : '—'}</dd>
          <dt className="text-suave">Pontos 3D</dt>
          <dd>{numero(m.gaussianas)}</dd>
          <dt className="text-suave">Fidelidade (PSNR)</dt>
          <dd>{m.psnr !== undefined ? `${numero(m.psnr, 1)} dB` : '—'}</dd>
          <dt className="text-suave">Rostos desfocados</dt>
          <dd>{numero(m.rostosDesfocados)}</dd>
        </dl>
        {c.avisos.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm text-suave">
            {c.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </Cartao>
    </>
  );
}
