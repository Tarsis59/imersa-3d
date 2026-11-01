'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAtualizarEnquanto } from '@/lib/atualizacao';
import { Aviso, Botao } from '@/components/ui';
import type { GirosDoPredio } from '@/lib/tipos';

const ROTULO = { na_fila: 'Na fila', processando: 'Renderizando na GPU', pronto: 'Pronto', erro: 'Erro' } as const;
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Giro 360° fotorrealista: o modelo do prédio renderizado no Blender (luz do sol, sombras e reflexos reais) em 72
 * imagens, com as unidades clicáveis. Roda na GPU gratuita do Kaggle pela fila das capturas (de hora em hora).
 */
export function GiroRenderizado({ giros, podePedir, pedir }: { giros: GirosDoPredio; podePedir: boolean; pedir: () => Promise<{ erro?: string }> }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const { ultimo, pronto } = giros;
  const andamento = ultimo && (ultimo.status === 'na_fila' || ultimo.status === 'processando');
  // na fila ou renderizando: confere de minuto em minuto (o render leva de minutos a uma hora)
  useAtualizarEnquanto(!!andamento, 60_000);

  return (
    <div className="grid gap-3 text-sm" data-testid="giro-renderizado" data-status={ultimo?.status ?? 'nenhum'}>
      <p className="text-suave">
        Imagens fotorrealistas do prédio girando 360°, com luz do sol, sombras e reflexos reais. Abre rápido até em celular fraco, e tocar numa unidade
        mostra os detalhes. O render roda numa placa de vídeo gratuita na nuvem e fica pronto em alguns minutos depois de entrar na fila, que é conferida
        de hora em hora.
      </p>
      {!giros.temModelo && <Aviso tipo="info">Ligue um modelo 3D ao prédio para gerar o giro.</Aviso>}
      {ultimo && (
        <p>
          <span className="font-medium">Último pedido:</span> {ROTULO[ultimo.status]} · {quando(ultimo.criadoEm)}
          {ultimo.status === 'erro' && ultimo.mensagem ? ` · ${ultimo.mensagem}` : ''}
        </p>
      )}
      {pronto && (
        <p>
          <span className="font-medium">Giro pronto:</span> {pronto.quadros} imagens · {quando(pronto.atualizadoEm)}
          {pronto.metricas.dispositivo ? ` · render em ${pronto.metricas.dispositivo === 'CPU' ? 'processador' : 'placa de vídeo'}` : ''}
          {pronto.atual ? ' · aparece na Vitrine e nos links para clientes.' : ''}
        </p>
      )}
      {pronto && !pronto.atual && (
        <Aviso tipo="info">
          {giros.vitrine
            ? 'As peças ligadas às unidades mudaram depois deste giro. Ele continua na Vitrine; gere outro para incluir as mudanças.'
            : 'O modelo 3D do prédio mudou depois deste giro. Gere outro para ele voltar à Vitrine.'}
        </Aviso>
      )}
      {podePedir && giros.temModelo && (
        <div>
          <Botao
            type="button"
            disabled={enviando || !!andamento}
            onClick={() =>
              iniciar(async () => {
                setErro(null);
                const r = await pedir();
                if (r.erro) setErro(r.erro);
                else router.refresh();
              })
            }
          >
            {andamento ? 'Giro na fila…' : pronto ? 'Gerar o giro de novo' : 'Gerar giro 360° fotorrealista'}
          </Botao>
        </div>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  );
}
