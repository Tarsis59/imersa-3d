import { manifesto } from '@/lib/manifesto';

/** App da equipe (painel). */
export function GET() {
  return Response.json(manifesto({ nome: 'Imersa 3D', curto: 'Imersa 3D', inicio: '/painel', escopo: '/', descricao: 'Plataforma imobiliária 3D' }), {
    headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' },
  });
}
