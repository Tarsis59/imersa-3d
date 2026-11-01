import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Me } from '@/lib/tipos';

interface Resumo {
  dias: number;
  sessoes: number;
  cargaMs: { p50: number | null; p95: number | null };
  fps: { p50: number | null; p05: number | null };
  taxaErro: number;
  porNivel: { alto: number; medio: number; baixo: number };
  celular: { sessoes: number; fpsP50: number | null };
  webgpu: { visitas: number; medidas: number };
}

const segundos = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`);
const fps = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} FPS`);

function Numero({ rotulo, valor, detalhe, testid }: { rotulo: string; valor: string; detalhe?: string; testid?: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-borda p-4">
      <span className="text-sm text-suave">{rotulo}</span>
      <strong data-testid={testid} className="text-2xl">
        {valor}
      </strong>
      {detalhe && <span className="text-xs text-suave">{detalhe}</span>}
    </div>
  );
}

export default async function PaginaTelemetria() {
  const volta = '/painel/telemetria';
  const me = (await apiNaPagina<Me>('/me', volta)).dados;
  if (!ehGestao(me.papel)) return <Aviso>Só a gestão da empresa vê o desempenho do 3D.</Aviso>;
  const r = await apiNaPagina<Resumo>('/telemetria/viewer/resumo?dias=7', volta);
  if (r.status === 403) return <Aviso>Ative a verificação em duas etapas (Segurança) para ver o desempenho do 3D.</Aviso>;
  if (r.status !== 200) return <Aviso tipo="erro">Não foi possível carregar o desempenho agora.</Aviso>;
  const d = r.dados;
  return (
    <>
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Desempenho do 3D</h1>
        <p className="text-sm text-suave">Visitas à Vitrine 3D nos últimos {d.dias} dias, medidas nos aparelhos reais de quem viu.</p>
      </div>
      <Cartao>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Numero rotulo="Visitas" valor={String(d.sessoes)} testid="telemetria-visitas" />
          <Numero rotulo="Carga até o 3D (mediana)" valor={segundos(d.cargaMs.p50)} detalhe={`95% das visitas em até ${segundos(d.cargaMs.p95)}`} />
          <Numero rotulo="Fluidez (mediana)" valor={fps(d.fps.p50)} detalhe={`5% piores: ${fps(d.fps.p05)}`} />
          <Numero rotulo="Visitas com erro" valor={`${(d.taxaErro * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} />
          <Numero rotulo="Pelo celular" valor={String(d.celular.sessoes)} detalhe={`fluidez mediana: ${fps(d.celular.fpsP50)}`} />
          <Numero
            rotulo="Aparelhos com WebGPU"
            valor={d.webgpu.medidas ? `${Math.round((d.webgpu.visitas / d.webgpu.medidas) * 100)}%` : '—'}
            detalhe={`${d.webgpu.visitas} de ${d.webgpu.medidas} visitas medidas: base da migração do 3D para WebGPU`}
            testid="telemetria-webgpu"
          />
          <Numero
            rotulo="Qualidade usada"
            valor={`${d.porNivel.alto} / ${d.porNivel.medio} / ${d.porNivel.baixo}`}
            detalhe="alta / média / baixa (ajuste automático pelo aparelho)"
          />
        </div>
      </Cartao>
    </>
  );
}
