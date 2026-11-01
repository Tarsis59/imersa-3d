'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Botao } from '@/components/ui';

type AcaoDepois = { tipo: 'video'; formato: '9:16' | '1:1' | '16:9'; voz: 'pf_dora' | 'pm_alex' | null } | { tipo: 'foto'; unidadeId: string | null; hora: number };
export interface RespostaComando {
  aplicado: boolean;
  mudancas: string[];
  avisos: string[];
  acoes: AcaoDepois[];
  erro?: string;
}

/**
 * Editar o empreendimento e pedir material por texto (Plano 11e, itens 22 e 23): "a 302 foi vendida", "o 5º andar
 * agora tem 6 unidades", "vídeo para o Instagram com voz masculina". Mostra o que vai mudar; só grava ao confirmar.
 */
export function PedirPorTexto({
  predioId,
  enviar,
  pedirVideo,
}: {
  predioId: string;
  enviar: (texto: string, aplicar: boolean) => Promise<RespostaComando>;
  pedirVideo: (formato: '9:16' | '1:1' | '16:9', narracao: { voz: 'pf_dora' | 'pm_alex' } | null) => Promise<{ erro?: string }>;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [previa, setPrevia] = useState<RespostaComando | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function verPrevia() {
    setErro(null);
    setFeito(null);
    setOcupado(true);
    const r = await enviar(texto, false);
    setOcupado(false);
    if (r.erro) return setErro(r.erro);
    setPrevia(r);
  }

  async function confirmar() {
    setOcupado(true);
    const r = await enviar(texto, true);
    if (r.erro) {
      setOcupado(false);
      return setErro(r.erro);
    }
    const extras: string[] = [];
    for (const a of r.acoes) {
      if (a.tipo === 'video') {
        const v = await pedirVideo(a.formato, a.voz ? { voz: a.voz } : null);
        extras.push(v.erro ? `Vídeo: ${v.erro}` : 'Vídeo na fila do estúdio.');
      }
    }
    setOcupado(false);
    setPrevia(null);
    setTexto('');
    setFeito([`${r.mudancas.length} mudança${r.mudancas.length === 1 ? '' : 's'} feita${r.mudancas.length === 1 ? '' : 's'} (no registro de auditoria).`, ...extras].join(' '));
    const foto = r.acoes.find((a): a is Extract<AcaoDepois, { tipo: 'foto' }> => a.tipo === 'foto');
    if (foto) router.push(`/painel/predios/${predioId}/vitrine?hora=${foto.hora}${foto.unidadeId ? `&unidade=${foto.unidadeId}` : ''}`);
    else router.refresh();
  }

  return (
    <div className="grid gap-3 text-sm" data-testid="pedir-por-texto">
      <label htmlFor="pedido-gestao" className="grid gap-1">
        <span className="font-medium">O que você quer mudar ou pedir?</span>
        <input
          id="pedido-gestao"
          value={texto}
          maxLength={500}
          onChange={(e) => {
            setTexto(e.target.value);
            setPrevia(null);
          }}
          placeholder="Ex.: a 302 foi vendida e a 1201 custa 850 mil"
          className="rounded-lg border border-borda bg-superficie px-3 py-2 text-base outline-none focus:border-acento focus:ring-2 focus:ring-acento/30"
        />
      </label>
      <div>
        <Botao type="button" variante="secundario" disabled={ocupado || texto.trim().length < 3} onClick={() => void verPrevia()}>
          Ver o que muda
        </Botao>
      </div>
      {previa && (
        <div className="grid gap-2 rounded-lg border border-borda p-3" data-testid="previa-comando">
          {previa.mudancas.length > 0 ? (
            <>
              <p className="font-medium">Vai mudar:</p>
              <ul className="list-disc pl-5">
                {previa.mudancas.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-suave">Nada para mudar.</p>
          )}
          {previa.avisos.length > 0 && (
            <ul className="list-disc pl-5 text-amber-700">
              {previa.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {previa.mudancas.length > 0 && (
            <div className="flex gap-2">
              <Botao type="button" disabled={ocupado} onClick={() => void confirmar()}>
                Confirmar
              </Botao>
              <Botao type="button" variante="secundario" onClick={() => setPrevia(null)}>
                Cancelar
              </Botao>
            </div>
          )}
        </div>
      )}
      {feito && <Aviso tipo="sucesso">{feito}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  );
}
