import { buscarPortal } from '@/lib/portal';
import { manifesto } from '@/lib/manifesto';

/** App do cliente: instalado a partir do link, abre direto no empreendimento dele. Link vencido = 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await buscarPortal(token);
  if (r?.status !== 200) return new Response(null, { status: 404 });
  const { projeto } = r.dados;
  const inicio = `/v/${encodeURIComponent(token)}`;
  return Response.json(manifesto({ nome: `${projeto.nome} em 3D`, curto: projeto.nome, inicio, escopo: inicio, descricao: `Visita em 3D do ${projeto.nome}` }), {
    // o link pode ser desativado: não guardar por muito tempo
    headers: { 'content-type': 'application/manifest+json', 'cache-control': 'private, max-age=300' },
  });
}
