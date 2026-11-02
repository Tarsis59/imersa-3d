import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, ROTULO_ETAPA, type IdEtapa, type Me } from '@/lib/tipos';

interface Aparelho {
  visitas: number;
  medidas: number;
  comWebgpu: number;
  percentual: number | null;
}
interface ProntoWebgpu {
  dias: number;
  celular: Aparelho;
  computador: Aparelho;
  fps: { comWebgpu: number | null; semWebgpu: number | null };
  limiarCelular: number;
  pronto: boolean;
  regra: string;
}

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
  // fluxo da criação integrada (Plano 11f): do envio ao 3D pronto
  const mt = await apiNaPagina<{ total: number; prontas: number; comAvisos: number; falhas: number; medianaMs: number | null; etapas: Record<IdEtapa, { feitas: number; avisos: number; falhas: number; mediaMs: number | null }> }>('/montagens/resumo', volta);
  const m = mt.status === 200 ? mt.dados : null;
  // Plano 12a, item 16: a decisão da troca de renderizador (WebGL2 → WebGPU), pronta e medida, nunca automática
  const wg = await apiNaPagina<ProntoWebgpu>('/telemetria/viewer/webgpu', volta);
  const w = wg.status === 200 ? wg.dados : null;
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
      {m && m.total > 0 && (
        <Cartao titulo="Criação integrada (últimos 90 dias)">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="telemetria-montagens">
            <Numero rotulo="Empreendimentos montados" valor={String(m.total)} detalhe={`${m.prontas} prontos, ${m.comAvisos} com avisos, ${m.falhas} com falha`} />
            <Numero rotulo="Do envio ao 3D pronto" valor={m.medianaMs === null ? '—' : `${(m.medianaMs / 1000).toFixed(1)} s`} detalhe="mediana (sem o 3D real das fotos, que roda na fila da GPU)" />
            <Numero rotulo="Taxa de sucesso" valor={`${Math.round(((m.prontas + m.comAvisos) / m.total) * 100)}%`} detalhe="prontos, com ou sem aviso" />
          </div>
          <ul className="mt-4 grid gap-1 text-sm">
            {(Object.keys(ROTULO_ETAPA) as IdEtapa[]).map((id) => {
              const e = m.etapas[id];
              return e ? (
                <li key={id} className="flex flex-wrap justify-between gap-2">
                  <span>{ROTULO_ETAPA[id]}</span>
                  <span className="text-suave">
                    {e.feitas} feitas · {e.avisos} avisos · {e.falhas} falhas{e.mediaMs !== null ? ` · ${(e.mediaMs / 1000).toFixed(1)} s` : ''}
                  </span>
                </li>
              ) : null;
            })}
          </ul>
        </Cartao>
      )}
      {w && (
        <Cartao titulo="Pronto para WebGPU?">
          <p className="text-sm text-suave">
            O 3D continua no WebGL2 (os efeitos visuais usam um recurso que o renderizador WebGPU do three.js ainda não aceita). Esta medida fica pronta para
            decidir a troca sem adivinhar: {w.regra}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="telemetria-pronto-webgpu" data-pronto={String(w.pronto)}>
            <Numero
              rotulo="Celular com WebGPU"
              valor={w.celular.percentual === null ? '—' : `${Math.round(w.celular.percentual * 100)}%`}
              detalhe={`${w.celular.comWebgpu} de ${w.celular.medidas} visitas medidas (meta: ${Math.round(w.limiarCelular * 100)}%)`}
              testid="telemetria-webgpu-celular"
            />
            <Numero
              rotulo="Computador com WebGPU"
              valor={w.computador.percentual === null ? '—' : `${Math.round(w.computador.percentual * 100)}%`}
              detalhe={`${w.computador.comWebgpu} de ${w.computador.medidas} visitas medidas`}
            />
            <Numero
              rotulo="Fluidez com WebGPU"
              valor={fps(w.fps.comWebgpu)}
              detalhe={`sem WebGPU: ${fps(w.fps.semWebgpu)} (celular, mediana)`}
            />
            <Numero rotulo="Decisão" valor={w.pronto ? 'Pode trocar' : 'Ainda no WebGL2'} testid="telemetria-webgpu-decisao" />
          </div>
        </Cartao>
      )}
    </>
  );
}
