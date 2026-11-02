'use client';
import { useEffect, useRef, useState } from 'react';
import { Botao } from '@/components/ui';
import { lerEventos } from '@/lib/sse';
import type { AcaoComando } from '@/lib/comandos';

/** O que a resposta pede para a tela fazer (vem da API: a IA só sugere, a tela executa). */
export type AcaoAssistente =
  | { tipo: 'mostrar'; unidades: string[]; focar: string | null }
  | { tipo: 'contato'; motivo: 'contato' | 'visita'; unidade: string | null }
  // a IA pede à tela o mesmo que a barra de comandos (filtros, hora, clima, lazer, entrar na unidade...)
  | { tipo: 'comandos'; acoes: AcaoComando[] };
type Mensagem = { papel: 'cliente' | 'assistente'; texto: string };

const SUGESTOES = ['Quais unidades de 3 quartos estão disponíveis?', 'O que tem perto do prédio?', 'Quero agendar uma visita'];
const ERROS: Record<string, string> = {
  ia_indisponivel: 'O assistente está desligado no momento.',
  limite_ia: 'O assistente atingiu o limite deste mês. Fale com a consultora pelo formulário.',
  ia_ocupada: 'O assistente está muito procurado agora. Tente de novo em alguns segundos.',
  muitos_pedidos: 'Muitas perguntas seguidas. Espere um pouco e tente de novo.',
};
const erroDe = (codigo: unknown) => ERROS[String(codigo)] ?? 'Não consegui responder agora. Tente de novo.';

/**
 * Chat com o assistente da Vitrine: resposta aparecendo aos poucos; quando ele fala de unidades, a tela destaca e
 * voa até elas. Conversa só nesta página (nada fica guardado no navegador).
 */
export function Assistente({
  url,
  aoAcao,
  pergunta,
  voz = false,
  aoFalar,
}: {
  url: string;
  aoAcao: (a: AcaoAssistente) => void;
  pergunta?: { texto: string; vez: number } | null;
  /** Corretora virtual: lê cada resposta em voz alta (voz do navegador, grátis). */
  voz?: boolean;
  aoFalar?: (falando: boolean) => void;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [entrada, setEntrada] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // rola só a caixa do chat (scrollIntoView rolaria a página inteira e tiraria a pessoa do formulário de contato)
  const lista = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens]);

  // pergunta vinda da barra de comandos (o que não era comando de tela)
  const ultimaVez = useRef(0);
  useEffect(() => {
    if (pergunta && pergunta.vez !== ultimaVez.current) {
      ultimaVez.current = pergunta.vez;
      void perguntar(pergunta.texto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispara só quando chega uma pergunta nova
  }, [pergunta]);

  function falar(texto: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const f = new SpeechSynthesisUtterance(texto);
    f.lang = 'pt-BR';
    const v = window.speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith('pt-br'));
    if (v) f.voice = v;
    f.onstart = () => aoFalar?.(true);
    f.onend = f.onerror = () => aoFalar?.(false);
    aoFalar?.(true);
    window.speechSynthesis.speak(f);
  }
  useEffect(() => () => void (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.cancel()), []);

  async function perguntar(texto: string) {
    const pergunta = texto.trim();
    if (!pergunta || ocupado) return;
    const historico = [...mensagens, { papel: 'cliente' as const, texto: pergunta }].slice(-20);
    setMensagens([...historico, { papel: 'assistente', texto: '' }]);
    setEntrada('');
    setErro(null);
    setOcupado(true);
    const escrever = (f: (atual: string) => string) =>
      setMensagens((ms) => ms.map((m, i) => (i === ms.length - 1 ? { ...m, texto: f(m.texto) } : m)));
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mensagens: historico }) });
      if (!r.ok || !r.body) {
        const corpo = (await r.json().catch(() => ({}))) as { erro?: string };
        throw new Error(erroDe(r.status === 429 && !corpo.erro ? 'muitos_pedidos' : corpo.erro));
      }
      await lerEventos(r.body, ({ evento, dados }) => {
        const d = dados as { t?: string; texto?: string; codigo?: string };
        if (evento === 'texto') escrever((t) => t + (d.t ?? ''));
        else if (evento === 'substituir' || evento === 'fim') {
          escrever(() => d.texto ?? '');
          if (evento === 'fim' && voz && d.texto) falar(d.texto);
        }
        else if (evento === 'acao') aoAcao(dados as AcaoAssistente);
        else if (evento === 'erro') throw new Error(erroDe(d.codigo));
      });
    } catch (e) {
      setErro((e as Error).message);
      // a pergunta sem resposta sai do histórico (a pessoa pode mandar de novo)
      setMensagens((ms) => ms.slice(0, -2));
      setEntrada(pergunta);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid gap-3 text-sm" data-testid="assistente">
      <div ref={lista} className="grid max-h-80 gap-2 overflow-y-auto" aria-live="polite" aria-busy={ocupado}>
        {mensagens.length === 0 && <p className="text-suave">Pergunte sobre unidades, preços, plantas e o que tem por perto. As respostas usam os dados do sistema.</p>}
        {mensagens.map((m, i) => (
          <p
            key={i}
            data-papel={m.papel}
            className={`whitespace-pre-wrap rounded-lg px-3 py-2 ${m.papel === 'cliente' ? 'ml-6 bg-acento text-acento-texto' : 'mr-6 bg-fundo'}`}
          >
            {m.texto || (ocupado && i === mensagens.length - 1 ? 'Pensando…' : '')}
          </p>
        ))}
      </div>
      {mensagens.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGESTOES.map((s) => (
            <button key={s} type="button" className="rounded-full border border-borda px-3 py-1 text-xs hover:bg-fundo" onClick={() => void perguntar(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {erro && (
        <p role="alert" className="text-perigo">
          {erro}
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void perguntar(entrada);
        }}
      >
        <label htmlFor="pergunta-assistente" className="sr-only">
          Sua pergunta
        </label>
        <input
          id="pergunta-assistente"
          value={entrada}
          maxLength={2000}
          onChange={(e) => setEntrada(e.target.value)}
          placeholder="Ex.: tem 2 quartos até 600 mil?"
          className="min-w-0 flex-1 rounded-lg border border-borda bg-superficie px-3 py-2"
        />
        <Botao type="submit" disabled={ocupado || !entrada.trim()}>
          {ocupado ? '…' : 'Perguntar'}
        </Botao>
      </form>
      <p className="text-xs text-suave">Assistente com IA: confira as condições com a consultora antes de fechar negócio.</p>
    </div>
  );
}
