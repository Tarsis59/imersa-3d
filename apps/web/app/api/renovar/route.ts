import { NextResponse, type NextRequest } from 'next/server';
import { api } from '@/lib/api';
import { lerSessao, salvarSessao, limparSessao, type Tokens } from '@/lib/sessao';

export async function GET(req: NextRequest) {
  const volta = req.nextUrl.searchParams.get('volta') ?? '/painel';
  const destino = volta.startsWith('/') && !volta.startsWith('//') ? volta : '/painel';
  const { refresh } = await lerSessao();
  if (refresh) {
    const r = await api<Tokens>('/auth/refresh', { metodo: 'POST', corpo: { refresh } });
    if (r.status === 200) {
      await salvarSessao(r.dados);
      return NextResponse.redirect(new URL(destino, req.url));
    }
  }
  await limparSessao();
  return NextResponse.redirect(new URL('/login', req.url));
}
