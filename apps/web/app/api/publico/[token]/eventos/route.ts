import { NextResponse, type NextRequest } from 'next/server';
import { api } from '@/lib/api';
import { TOKEN_LINK } from '@/lib/portal';

const vazio = (status = 204) => new NextResponse(null, { status });

/** Recebe os eventos do portal do comprador (fetch com keepalive ou sendBeacon ao sair) e repassa à API com o IP de quem viu. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_LINK.test(token)) return vazio(404);
  const origem = req.headers.get('origin');
  if (origem && origem !== req.nextUrl.origin) return vazio(403);
  const texto = await req.text();
  if (texto.length > 8192) return vazio(413);
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return vazio(400);
  }
  const r = await api(`/publico/links/${token}/eventos`, { metodo: 'POST', corpo }).catch(() => null);
  return vazio(r?.status === 204 ? 204 : (r?.status ?? 502));
}
