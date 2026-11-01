import { NextResponse, type NextRequest } from 'next/server';
import { apiArquivo } from '@/lib/api';
import { lerSessao } from '@/lib/sessao';

/** Pacote do estande em Unreal (JSON): baixado pelo painel com o acesso de quem está logado. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: 'nao_encontrado' }, { status: 404 });
  const { acesso } = await lerSessao();
  if (!acesso) return NextResponse.json({ erro: 'sessao_expirada' }, { status: 401 });
  const r = await apiArquivo(`/predios/${id}/pacote-unreal`, acesso);
  if (!r.ok) return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify(await r.json(), null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="imersa-estande.json"', 'cache-control': 'no-store' },
  });
}
