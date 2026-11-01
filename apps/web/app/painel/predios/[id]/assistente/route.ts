import { NextResponse, type NextRequest } from 'next/server';
import { apiFluxo } from '@/lib/api';
import { lerSessao } from '@/lib/sessao';

/**
 * Assistente na Vitrine do painel: repassa a pergunta à API com o acesso de quem está logado e devolve a resposta
 * em fluxo (SSE), sem esperar terminar. O portal do cliente chama a API direto (não tem sessão).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origem = req.headers.get('origin');
  if (origem && origem !== req.nextUrl.origin) return NextResponse.json({ erro: 'origem_invalida' }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: 'nao_encontrado' }, { status: 404 });
  const corpo = await req.text();
  if (corpo.length > 64 * 1024) return NextResponse.json({ erro: 'muito_grande' }, { status: 413 });
  const { acesso } = await lerSessao();
  if (!acesso) return NextResponse.json({ erro: 'sessao_expirada' }, { status: 401 });
  const r = await apiFluxo(`/predios/${id}/assistente`, { corpo, token: acesso });
  return new Response(r.body, {
    status: r.status,
    headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
}
