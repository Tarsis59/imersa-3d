import { NextResponse, type NextRequest } from 'next/server';
import { apiFluxo } from '@/lib/api';
import { lerSessao } from '@/lib/sessao';

/** Tour guiado ao vivo: a câmera da consultora vai para a API (que repassa a quem assiste o link). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origem = req.headers.get('origin');
  if (origem && origem !== req.nextUrl.origin) return NextResponse.json({ erro: 'origem_invalida' }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: 'nao_encontrado' }, { status: 404 });
  const corpo = await req.text();
  if (corpo.length > 2048) return NextResponse.json({ erro: 'muito_grande' }, { status: 413 });
  const { acesso } = await lerSessao();
  if (!acesso) return NextResponse.json({ erro: 'sessao_expirada' }, { status: 401 });
  const r = await apiFluxo(`/links/${id}/conducao`, { corpo, token: acesso });
  return new Response(null, { status: r.status });
}
