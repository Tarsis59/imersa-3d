'use client';
import { useEffect, useRef, useState } from 'react';
import type { UnidadeViewer } from '@imersa/viewer';
import { Aviso, Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { Vitrine, type EventoVitrine } from '@/app/painel/predios/[id]/vitrine/vitrine';
import type { ResultadoEntorno } from '@/app/painel/predios/[id]/vitrine/actions';
import type { Portal } from '@/lib/tipos';
import type { DadosLead } from './actions';

type EventoApi = { tipo: 'abriu' | 'unidade' | 'favorito' | 'interior' | 'tempo'; unidadeId?: string; duracaoS?: number };
const ENVIO_S = 15;

/** Eventos da visita em lotes (a cada 15 s e ao sair da página), sem atrasar o 3D. */
function useEventos(token: string) {
  const fila = useRef<EventoApi[]>([]);
  const sessao = useRef<string | null>(null);
  const inicio = useRef(0);
  useEffect(() => {
    sessao.current ??= crypto.randomUUID();
    inicio.current = Date.now();
    const url = `/api/publico/${token}/eventos`;
    const corpo = (eventos: EventoApi[]) => JSON.stringify({ sessao: sessao.current, eventos });
    const enviar = () => {
      if (!fila.current.length) return;
      const eventos = fila.current.splice(0, 50);
      void fetch(url, { method: 'POST', body: corpo(eventos), headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => undefined);
    };
    let saiu = false;
    const sair = () => {
      if (saiu) return;
      saiu = true;
      fila.current.push({ tipo: 'tempo', duracaoS: Math.min(86_400, Math.round((Date.now() - inicio.current) / 1000)) });
      const eventos = fila.current.splice(0, 50);
      navigator.sendBeacon?.(url, new Blob([corpo(eventos)], { type: 'application/json' }));
    };
    const aoEsconder = () => document.visibilityState === 'hidden' && sair();
    fila.current.push({ tipo: 'abriu' });
    // 1º envio logo depois de montar (não no mesmo instante): no modo estrito o React monta, desmonta e monta
    // de novo, e a montagem descartada não pode contar uma visita
    const primeiro = setTimeout(enviar, 1000);
    const t = setInterval(enviar, ENVIO_S * 1000);
    window.addEventListener('pagehide', sair);
    document.addEventListener('visibilitychange', aoEsconder);
    return () => {
      clearTimeout(primeiro);
      clearInterval(t);
      window.removeEventListener('pagehide', sair);
      document.removeEventListener('visibilitychange', aoEsconder);
      fila.current = fila.current.filter((e) => e.tipo !== 'abriu');
    };
  }, [token]);
  return (e: EventoVitrine) => fila.current.push(e);
}

export function PortalVitrine({
  token,
  portal,
  carregarEntorno,
  linkDoArquivo,
  enviarLead,
}: {
  token: string;
  portal: Portal;
  carregarEntorno: () => Promise<ResultadoEntorno>;
  linkDoArquivo: (arquivoId: string) => Promise<string | null>;
  enviarLead: (d: DadosLead) => Promise<{ ok: true } | { ok: false; erro: string }>;
}) {
  const registrar = useEventos(token);
  const [unidadeVista, setUnidadeVista] = useState('');
  // pedido do assistente: abre o formulário com a unidade e o motivo (os dados pessoais a pessoa digita lá)
  const [pedidoContato, setPedidoContato] = useState<{ motivo: 'contato' | 'visita'; unidadeId: string | null; vez: number } | null>(null);
  const aoEvento = (e: EventoVitrine) => {
    registrar(e);
    if (e.tipo === 'unidade') setUnidadeVista(e.unidadeId);
  };
  const unidades: UnidadeViewer[] = portal.unidades.map((u) => ({ id: u.id, codigo: u.codigo, andar: u.andar, status: u.status, areaM2: u.areaM2, quartos: u.quartos, preco: u.preco, meshNodeId: u.meshNodeId }));
  return (
    <>
      <Vitrine
        predioId={portal.predio.id}
        projetoId={portal.projeto.id}
        predioNome={portal.predio.nome}
        empresa={portal.empresa.nome}
        chaveModelo={portal.modeloUrl ? 'modelo' : 'volumes'}
        modeloUrl={portal.modeloUrl}
        unidades={unidades}
        andares={portal.andares}
        rotacaoGraus={portal.projeto.rotacaoGraus}
        lat={portal.projeto.lat}
        lon={portal.projeto.lon}
        interiores={portal.interiores}
        giroRenderizado={portal.giro}
        assistenteUrl={portal.assistenteUrl}
        aoPedirContato={(motivo, unidadeId) => setPedidoContato((p) => ({ motivo, unidadeId, vez: (p?.vez ?? 0) + 1 }))}
        carregarEntorno={carregarEntorno}
        linkDoArquivo={linkDoArquivo}
        telemetria={false}
        aoEvento={aoEvento}
        aoVivo={async () => portal.aoVivoUrl}
      />
      <FormularioLead portal={portal} unidadeVista={unidadeVista} enviarLead={enviarLead} pedido={pedidoContato} />
    </>
  );
}

function FormularioLead({
  portal,
  unidadeVista,
  enviarLead,
  pedido,
}: {
  portal: Portal;
  unidadeVista: string;
  enviarLead: (d: DadosLead) => Promise<{ ok: true } | { ok: false; erro: string }>;
  pedido: { motivo: 'contato' | 'visita'; unidadeId: string | null; vez: number } | null;
}) {
  const textoConsentimento = `Autorizo ${portal.empresa.nome} e ${portal.consultora.nome} a usar meu nome e meus contatos para falar comigo sobre o ${portal.projeto.nome}. Posso pedir a exclusão dos meus dados a qualquer momento.`;
  // unidadeId null = a pessoa ainda não escolheu: vale a última unidade vista no 3D
  const [d, setD] = useState<Omit<DadosLead, 'unidadeId' | 'textoConsentimento'> & { unidadeId: string | null }>({
    nome: '',
    telefone: '',
    email: '',
    mensagem: '',
    unidadeId: null,
    consentimento: false,
    site: '',
  });
  // o assistente pediu o contato: preenche unidade e motivo e leva a pessoa até o formulário
  useEffect(() => {
    if (!pedido) return;
    setD((x) => ({
      ...x,
      unidadeId: pedido.unidadeId ?? x.unidadeId,
      mensagem: x.mensagem || (pedido.motivo === 'visita' ? 'Quero agendar uma visita.' : ''),
    }));
    document.getElementById('contato')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pedido]);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: true } | { ok: false; erro: string } | null>(null);
  const unidade = d.unidadeId ?? unidadeVista;
  const disponiveis = portal.unidades.filter((u) => u.status === 'disponivel' || u.id === unidade);

  if (resultado?.ok) {
    return (
      <section id="contato" className="scroll-mt-4">
        <Cartao titulo="Pedido enviado">
          <Aviso tipo="sucesso">
            Obrigado, {d.nome.split(' ')[0]}! {portal.consultora.nome} vai entrar em contato com você.
          </Aviso>
        </Cartao>
      </section>
    );
  }
  return (
    <section id="contato" className="scroll-mt-4">
      <Cartao titulo={`Quero falar com ${portal.consultora.nome}`}>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setEnviando(true);
            setResultado(null);
            try {
              setResultado(await enviarLead({ ...d, unidadeId: unidade, textoConsentimento }));
            } catch {
              setResultado({ ok: false, erro: 'Não foi possível enviar agora. Tente de novo em instantes.' });
            } finally {
              setEnviando(false);
            }
          }}
        >
          {/* armadilha para robôs: invisível para pessoas (e para leitores de tela); robô que preenche é descartado pela API */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label htmlFor="lead-site">Site</label>
            <input id="lead-site" tabIndex={-1} autoComplete="off" value={d.site} onChange={(e) => setD({ ...d, site: e.target.value })} />
          </div>
          <Campo id="lead-nome" rotulo="Seu nome" required minLength={2} maxLength={120} autoComplete="name" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="lead-telefone" rotulo="WhatsApp ou telefone (com DDD)" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} value={d.telefone} onChange={(e) => setD({ ...d, telefone: e.target.value })} />
            <Campo id="lead-email" rotulo="E-mail" type="email" autoComplete="email" maxLength={254} value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
          </div>
          <Selecao id="lead-unidade" rotulo="Unidade de interesse (opcional)" value={unidade} onChange={(e) => setD({ ...d, unidadeId: e.target.value })}>
            <option value="">Nenhuma em especial</option>
            {disponiveis.map((u) => (
              <option key={u.id} value={u.id}>
                {u.codigo}
                {u.tipologia ? ` · ${u.tipologia}` : ''}
              </option>
            ))}
          </Selecao>
          <label htmlFor="lead-mensagem" className="grid gap-1 text-sm">
            <span className="font-medium">Mensagem (opcional)</span>
            <textarea
              id="lead-mensagem"
              rows={3}
              maxLength={2000}
              value={d.mensagem}
              onChange={(e) => setD({ ...d, mensagem: e.target.value })}
              className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-base outline-none focus:border-acento focus:ring-2 focus:ring-acento/30"
            />
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={d.consentimento} onChange={(e) => setD({ ...d, consentimento: e.target.checked })} />
            <span>{textoConsentimento}</span>
          </label>
          {resultado && !resultado.ok && <Aviso tipo="erro">{resultado.erro}</Aviso>}
          <Botao type="submit" disabled={enviando || !d.consentimento || d.nome.trim().length < 2 || (!d.telefone.trim() && !d.email.trim())}>
            {enviando ? 'Enviando…' : 'Enviar pedido de contato'}
          </Botao>
          <p className="text-xs text-suave">Seus dados vão só para {portal.empresa.nome}, para este atendimento (LGPD, base legal: consentimento).</p>
        </form>
      </Cartao>
    </section>
  );
}
