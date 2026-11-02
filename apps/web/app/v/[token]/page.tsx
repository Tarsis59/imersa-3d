import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { buscarPortal } from '@/lib/portal';
import { carregarEntornoPublico, enviarLead, linkArquivoPublico, listarPontosPublico, rotaAtePublico } from './actions';
import { PortalVitrine } from './portal';

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await buscarPortal((await params).token);
  // link privado: não entra em buscadores
  const robots = { index: false, follow: false };
  if (r?.status !== 200) return { title: 'Link indisponível · Imersa 3D', robots };
  const { projeto, predio, empresa, consultora } = r.dados;
  const local = [projeto.cidade, projeto.uf].filter(Boolean).join(' – ');
  const titulo = `${projeto.nome} · ${predio.nome} em 3D`;
  const descricao = `Visite o ${projeto.nome}${local ? ` (${local})` : ''} em 3D pelo celular: unidades, vista e interior. Atendimento: ${consultora.nome}, ${empresa.nome}.`;
  // app instalável: "Adicionar à tela inicial" abre direto neste empreendimento
  const token = (await params).token;
  return {
    title: titulo,
    description: descricao,
    robots,
    openGraph: { title: titulo, description: descricao, type: 'website', locale: 'pt_BR', siteName: empresa.nome },
    manifest: `/v/${encodeURIComponent(token)}/app.webmanifest`,
    appleWebApp: { capable: true, title: projeto.nome.slice(0, 30), statusBarStyle: 'black-translucent' },
  };
}

/** Portal do comprador: aberto pelo link que a consultora mandou (sem login). */
export default async function PaginaPortal({ params }: Props) {
  const { token } = await params;
  const r = await buscarPortal(token);
  if (!r || r.status === 404) notFound();
  if (r.status === 410) {
    return (
      <main className="mx-auto grid max-w-xl gap-3 px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Este link não está mais disponível</h1>
        <p className="text-suave">Ele venceu ou foi desativado. Peça um novo link para a sua consultora.</p>
      </main>
    );
  }
  if (r.status !== 200) throw new Error('portal indisponível');
  const p = r.dados;
  const local = [p.projeto.cidade, p.projeto.uf].filter(Boolean).join(' – ');
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <span className="text-sm text-suave">{p.empresa.nome}</span>
          <h1 className="text-2xl font-bold">
            {p.projeto.nome} · {p.predio.nome}
          </h1>
          <p className="text-sm text-suave">
            {local && `${local} · `}Atendimento: <strong>{p.consultora.nome}</strong>
          </p>
        </div>
        <a href="#contato" className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-acento-texto hover:opacity-90">
          Quero falar com {p.consultora.nome.split(' ')[0]}
        </a>
      </header>
      {p.projeto.descricao && <p className="max-w-3xl whitespace-pre-line text-sm">{p.projeto.descricao}</p>}
      <PortalVitrine
        token={token}
        portal={p}
        carregarEntorno={carregarEntornoPublico.bind(null, token)}
        proximidades={{ listar: listarPontosPublico.bind(null, token), rota: rotaAtePublico.bind(null, token) }}
        linkDoArquivo={linkArquivoPublico.bind(null, token)}
        enviarLead={enviarLead.bind(null, token)}
      />
      <footer className="pb-6 text-center text-xs text-suave">Visita 3D por Imersa 3D · os números das unidades e os preços são informados por {p.empresa.nome}.</footer>
    </div>
  );
}
