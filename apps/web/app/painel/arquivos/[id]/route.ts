import { NextResponse, type NextRequest } from 'next/server';
import { api } from '@/lib/api';
import { lerSessao } from '@/lib/sessao';

/** Baixar arquivo: pede à API um link assinado de curta duração e redireciona para ele. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { acesso } = await lerSessao();
  if (!acesso) return NextResponse.redirect(new URL(`/api/renovar?volta=${encodeURIComponent(`/painel/arquivos/${id}`)}`, req.url));
  const r = await api<{ url: string }>(`/arquivos/${encodeURIComponent(id)}/download`, { token: acesso });
  if (r.status !== 200) return new NextResponse('Arquivo não encontrado.', { status: 404 });
  return NextResponse.redirect(r.dados.url);
}
