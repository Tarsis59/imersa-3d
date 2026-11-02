'use client';
import { useEffect, useRef, useState } from 'react';
import { interpretarComando, type AcaoComando } from '@/lib/comandos';

interface Reconhecimento {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type ConstrutorReconhecimento = new () => Reconhecimento;

const EXEMPLOS = ['3 quartos com sol da manhã até 900 mil', 'vá para a piscina', 'mostre à noite', 'entra na 101'];

/**
 * Barra de comandos da Vitrine (Plano 11e, item 20): escreve ou fala ("mostre as de 3 quartos com sol da manhã") e a
 * tela obedece na hora. O que não for comando vai para o assistente, quando ele existe.
 */
export function ComandoVitrine({ aoExecutar, aoPerguntar, pronto }: { aoExecutar: (acoes: AcaoComando[]) => string[]; aoPerguntar: ((texto: string) => void) | null; pronto: boolean }) {
  const [texto, setTexto] = useState('');
  const [retorno, setRetorno] = useState<{ tipo: 'ok' | 'nao'; texto: string } | null>(null);
  const [ouvindo, setOuvindo] = useState(false);
  const [temVoz, setTemVoz] = useState(false);
  const rec = useRef<Reconhecimento | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: ConstrutorReconhecimento; webkitSpeechRecognition?: ConstrutorReconhecimento };
    setTemVoz(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    return () => rec.current?.stop();
  }, []);

  function executar(frase: string) {
    const f = frase.trim();
    if (!f) return;
    const { acoes, resumo } = interpretarComando(f);
    if (!acoes.length) {
      if (aoPerguntar) {
        aoPerguntar(f);
        setRetorno({ tipo: 'ok', texto: 'Perguntei ao assistente (veja a resposta abaixo).' });
      } else setRetorno({ tipo: 'nao', texto: `Não entendi. Tente: “${EXEMPLOS[Math.floor(Math.random() * EXEMPLOS.length)]}”.` });
      return;
    }
    const problemas = aoExecutar(acoes);
    setRetorno(problemas.length ? { tipo: 'nao', texto: `${resumo ? `Entendi: ${resumo}. ` : ''}${problemas.join(' ')}` } : { tipo: 'ok', texto: `Entendi: ${resumo}.` });
    setTexto('');
  }

  function falar() {
    const w = window as unknown as { SpeechRecognition?: ConstrutorReconhecimento; webkitSpeechRecognition?: ConstrutorReconhecimento };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C) return;
    if (ouvindo) {
      rec.current?.stop();
      return;
    }
    const r = new C();
    r.lang = 'pt-BR';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const frase = e.results[0]?.[0]?.transcript ?? '';
      setTexto(frase);
      executar(frase);
    };
    r.onend = () => setOuvindo(false);
    r.onerror = () => {
      setOuvindo(false);
      setRetorno({ tipo: 'nao', texto: 'Não consegui ouvir. Confira a permissão do microfone ou escreva o pedido.' });
    };
    rec.current = r;
    setOuvindo(true);
    r.start();
  }

  return (
    <div className="grid gap-2" data-testid="comando-vitrine">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          executar(texto);
        }}
      >
        <label htmlFor="comando" className="sr-only">
          Peça o que quiser ver
        </label>
        <input
          id="comando"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={300}
          disabled={!pronto}
          placeholder="Ex.: 3 quartos com sol da manhã até 900 mil"
          className="min-w-0 flex-1 rounded-lg border border-borda bg-superficie px-3 py-2 text-base outline-none focus:border-acento focus:ring-2 focus:ring-acento/30"
        />
        {temVoz && (
          <button
            type="button"
            onClick={falar}
            disabled={!pronto}
            aria-pressed={ouvindo}
            aria-label={ouvindo ? 'Parar de ouvir' : 'Falar o pedido'}
            className={`grid size-10 shrink-0 place-items-center rounded-lg border text-lg ${ouvindo ? 'animate-pulse border-perigo bg-perigo/10' : 'border-borda bg-superficie'}`}
          >
            🎤
          </button>
        )}
        <button type="submit" disabled={!pronto || !texto.trim()} className="shrink-0 rounded-lg bg-acento px-4 text-sm font-semibold text-acento-texto disabled:opacity-50">
          Ir
        </button>
      </form>
      {retorno && (
        <p role="status" data-testid="retorno-comando" className={`text-sm ${retorno.tipo === 'ok' ? 'text-suave' : 'text-perigo'}`}>
          {retorno.texto}
        </p>
      )}
    </div>
  );
}
