import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { lerOcioso, lerSinal } from '@/lib/estande';
import { buscarPortal, TOKEN_LINK } from '@/lib/portal';
import { carregarEntornoPublico, linkArquivoPublico, listarPontosPublico, rotaAtePublico } from '@/app/v/[token]/actions';
import { enviarSinal } from './actions';
import { TelaEstande } from './estande';

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ ocioso?: string; sinal?: string }> };

// estande é endereço privado do PC da construtora: fora de buscadores
export const metadata: Metadata = { title: 'Estande · Imersa 3D', robots: { index: false, follow: false } };
// tela touch: sem zoom de pinça na página (o 3D tem o próprio zoom)
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

function Desativado() {
  return (
    <main data-testid="estande-desativado" className="grid min-h-dvh place-items-center bg-fundo p-8 text-center">
      <div className="grid gap-3">
        <h1 className="text-3xl font-bold">Estande desativado</h1>
        <p className="text-lg text-suave">Fale com a equipe de vendas.</p>
      </div>
    </main>
  );
}

/** PC do estande de vendas: a Vitrine em tela cheia, aberta pelo endereço criado no painel (sem login). */
export default async function PaginaEstande({ params, searchParams }: Props) {
  const { token } = await params;
  if (!TOKEN_LINK.test(token)) notFound();
  const [estande, portal] = await Promise.all([api<{ nome: string; qrUrl: string }>(`/publico/estandes/${token}`), buscarPortal(token)]);
  if (estande.status === 404 || !portal || portal.status === 404) notFound();
  if (estande.status === 410 || portal.status === 410) return <Desativado />;
  if (estande.status !== 200 || portal.status !== 200) throw new Error('estande indisponível');
  const busca = await searchParams;
  const qr = await QRCode.toDataURL(estande.dados.qrUrl, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
  return (
    <TelaEstande
      token={token}
      portal={portal.dados}
      nome={estande.dados.nome}
      qr={qr}
      ociosoS={lerOcioso(busca.ocioso)}
      sinalS={lerSinal(busca.sinal)}
      carregarEntorno={carregarEntornoPublico.bind(null, token)}
      proximidades={{ listar: listarPontosPublico.bind(null, token), rota: rotaAtePublico.bind(null, token) }}
      linkDoArquivo={linkArquivoPublico.bind(null, token)}
      sinal={enviarSinal.bind(null, token)}
    />
  );
}
