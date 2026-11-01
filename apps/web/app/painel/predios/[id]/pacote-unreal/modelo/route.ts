import { NextResponse, type NextRequest } from 'next/server';
import { apiArquivo } from '@/lib/api';
import { lerSessao } from '@/lib/sessao';

/** Modelo do prédio sem compressão (o importador glTF do Unreal não lê Meshopt). */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: 'nao_encontrado' }, { status: 404 });
  const { acesso } = await lerSessao();
  if (!acesso) return NextResponse.json({ erro: 'sessao_expirada' }, { status: 401 });
  const r = await apiArquivo(`/predios/${id}/pacote-unreal/modelo.glb`, acesso);
  if (!r.ok) return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
  return new Response(r.body, { headers: { 'content-type': 'model/gltf-binary', 'content-disposition': 'attachment; filename="modelo.glb"', 'cache-control': 'no-store' } });
}
