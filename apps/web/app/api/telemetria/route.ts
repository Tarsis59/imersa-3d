import { NextResponse, type NextRequest } from 'next/server';
import { api } from '@/lib/api';
import { lerSessao } from '@/lib/sessao';

const vazio = (status = 204) => new NextResponse(null, { status });

/**
 * Recebe o `sendBeacon` da Vitrine e repassa à API com o acesso de quem estava vendo.
 * Não renova a sessão aqui (o envio acontece ao sair da página): sem acesso válido, a visita é descartada.
 */
export async function POST(req: NextRequest) {
  const origem = req.headers.get('origin');
  if (origem && origem !== req.nextUrl.origin) return vazio(403);
  const texto = await req.text();
  if (texto.length > 2048) return vazio(413);
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return vazio(400);
  }
  const { acesso } = await lerSessao();
  if (!acesso) return vazio();
  await api('/telemetria/viewer', { metodo: 'POST', corpo, token: acesso }).catch(() => undefined);
  return vazio();
}
