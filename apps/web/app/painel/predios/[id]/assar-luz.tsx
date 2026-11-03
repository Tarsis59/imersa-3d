'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useAtualizarEnquanto } from '@/lib/atualizacao';
import { Aviso, Botao } from '@/components/ui';
import type { BakesDoPredio } from '@/lib/tipos';

const ROTULO = { na_fila: 'Na fila', processando: 'Assando na GPU', pronto: 'Pronto', erro: 'Erro' } as const;
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Luz pré-calculada de dia e de noite (Plano 12a, item 6): bake no Blender/Cycles (AO + luz difusa) do modelo do
 * prédio, na GPU gratuita do Kaggle (mesma fila dos giros e vídeos). O GLB "assado" substitui o cru na Vitrine,
 * com o aoMap e o lightMap cruzando dia↔noite pela hora escolhida.
 */
export function AssarLuz({ dados, podePedir, pedir }: { dados: BakesDoPredio; podePedir: boolean; pedir: () => Promise<{ erro?: string }> }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const { ultimo, pronto } = dados;
  const andamento = ultimo && (ultimo.status === 'na_fila' || ultimo.status === 'processando');
  useAtualizarEnquanto(!!andamento, 60_000);

  return (
    <div className="grid gap-3 text-sm" data-testid="assar-luz" data-status={ultimo?.status ?? 'nenhum'}>
      <p className="text-suave">
        Assa a oclusão ambiente e a luz difusa do prédio no Blender (céu de dia com sol às 16h30 e uma variante de noite com as janelas e os postes acesos),
        para o 3D parecer um render sem custar o Lumen do Unreal. Roda na GPU gratuita do Kaggle; a fila é conferida de hora em hora.
      </p>
      {!dados.temModelo && <Aviso tipo="info">Ligue um modelo 3D ao prédio para assar a luz.</Aviso>}
      {ultimo && (
        <p>
          <span className="font-medium">Último pedido:</span> {ROTULO[ultimo.status]} · {quando(ultimo.criadoEm)}
          {ultimo.status === 'erro' && ultimo.mensagem ? ` · ${ultimo.mensagem}` : ''}
        </p>
      )}
      {pronto && (
        <p>
          <span className="font-medium">Bake pronto:</span> {quando(pronto.atualizadoEm)}
          {pronto.metricas.dispositivo ? ` · render em ${pronto.metricas.dispositivo === 'CPU' ? 'processador' : 'placa de vídeo'}` : ''}
          {pronto.atual ? ' · aparece na Vitrine e nos links para clientes.' : ''}
        </p>
      )}
      {pronto && !pronto.atual && <Aviso tipo="info">O modelo 3D do prédio mudou depois deste bake. Assa de novo para ele voltar à Vitrine.</Aviso>}
      {podePedir && dados.temModelo && (
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
            {andamento ? 'Bake na fila…' : pronto ? 'Assar a luz de novo' : 'Assar a luz (dia e noite)'}
          </Botao>
        </div>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  );
}
