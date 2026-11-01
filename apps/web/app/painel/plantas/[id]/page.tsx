import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AberturaPx, EdicaoPlanta, SegmentoPx } from '@imersa/viewer';
import { Aviso } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import type { DetalheProjeto } from '@/lib/tipos';
import { concluirEnvio, prepararEnvio } from '../../projetos/[id]/actions-arquivos';
import { salvarEdicao, usarModelo } from './actions';
import { EditorPlanta } from './editor';

interface Deteccao {
  largura: number;
  altura: number;
  escalaMPorPx: number | null;
  espessuraPx: number | null;
  paredes: SegmentoPx[];
  aberturas: AberturaPx[];
  avisos?: string[];
}
interface Planta {
  id: string;
  status: string;
  projetoId: string;
  projetoNome: string;
  arquivoNome: string;
  imagemArquivoId: string | null;
  deteccao: Deteccao;
  edicao: Partial<EdicaoPlanta>;
  glbArquivoId: string | null;
}

export default async function PaginaEditorPlanta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const volta = `/painel/plantas/${id}`;
  const r = await apiNaPagina<Planta>(`/plantas/${encodeURIComponent(id)}`, volta);
  if (r.status === 403) return <Aviso>Só a gestão (com a verificação em duas etapas) edita plantas.</Aviso>;
  if (r.status !== 200) notFound();
  const p = r.dados;
  const [imagem, projeto] = await Promise.all([
    p.imagemArquivoId ? apiNaPagina<{ url: string }>(`/arquivos/${p.imagemArquivoId}/download`, volta) : null,
    apiNaPagina<DetalheProjeto>(`/projetos/${p.projetoId}`, volta),
  ]);
  if (p.status !== 'pronto' || imagem?.status !== 200) return <Aviso>A planta ainda está sendo lida. Volte em instantes.</Aviso>;
  const d = p.deteccao;
  const editada = (p.edicao.paredes?.length ?? 0) > 0;
  return (
    <>
      <div className="grid gap-1">
        <Link href={`/painel/projetos/${p.projetoId}`} className="text-sm text-suave hover:underline">
          ← {p.projetoNome}
        </Link>
        <h1 className="text-2xl font-bold">Planta → 3D · {p.arquivoNome}</h1>
        <p className="text-sm text-suave">
          Confira o que o sistema achou: paredes (laranja), portas (vermelho), janelas (azul) e passagens (verde). Marque uma medida conhecida para a escala,
          corrija o que precisar e gere o 3D.
        </p>
      </div>
      {!editada && d.avisos?.map((a) => <Aviso key={a}>{a}</Aviso>)}
      <EditorPlanta
        nome={p.arquivoNome}
        imagemUrl={imagem.dados.url}
        largura={d.largura}
        altura={d.altura}
        espessuraPx={d.espessuraPx ?? 10}
        inicial={{
          escalaMPorPx: p.edicao.escalaMPorPx ?? d.escalaMPorPx ?? null,
          alturaParedeM: p.edicao.alturaParedeM ?? 2.8,
          alturaPortaM: p.edicao.alturaPortaM ?? 2.1,
          peitorilM: p.edicao.peitorilM ?? 1.0,
          alturaJanelaM: p.edicao.alturaJanelaM ?? 1.2,
          paredes: editada ? p.edicao.paredes! : d.paredes,
          aberturas: editada ? (p.edicao.aberturas ?? []) : d.aberturas,
        }}
        predios={(projeto.dados.predios ?? []).map((x) => ({ id: x.id, nome: x.nome }))}
        acoes={{ salvar: salvarEdicao.bind(null, p.id), usarModelo: usarModelo.bind(null, p.id, p.projetoId), prepararEnvio: prepararEnvio.bind(null, p.projetoId), concluirEnvio: concluirEnvio.bind(null, p.projetoId) }}
      />
    </>
  );
}
