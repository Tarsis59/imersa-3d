'use client';
import { useEffect, useRef, useState } from 'react';
import { Botao } from '@/components/ui';
import { SalaDeVisita, type PessoaNaSala } from '@/lib/sala';
import type { Viewer } from '@imersa/viewer';

/** Visita em grupo (Plano 11d, item 18): a família entra pelo mesmo link, cada um com seu boneco, e conversa por voz. */
export function VisitaEmGrupo({ url, viewer, pronto }: { url: string; viewer: { current: Viewer | null }; pronto: boolean }) {
  const [nome, setNome] = useState('');
  const [estado, setEstado] = useState<'fora' | 'conectando' | 'na_sala' | 'cheia'>('fora');
  const [pessoas, setPessoas] = useState<PessoaNaSala[]>([]);
  const [voz, setVoz] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const sala = useRef<SalaDeVisita | null>(null);

  // minha posição vai para a sala a cada 0,5 s; os bonecos dos outros entram no 3D
  useEffect(() => {
    if (estado !== 'na_sala') return;
    const t = setInterval(() => sala.current?.posicao(viewer.current?.minhaPosicao() ?? null), 500);
    return () => clearInterval(t);
  }, [estado, viewer]);
  useEffect(() => {
    viewer.current?.definirOutros(pessoas.flatMap((p) => (p.pos ? [{ id: p.id, ...p.pos }] : [])));
  }, [pessoas, viewer]);
  useEffect(() => () => sala.current?.sair(), []);

  function entrar() {
    const s = new SalaDeVisita(url, nome.trim() || 'Visitante', (lista, e) => {
      setPessoas(lista);
      setEstado(e);
    });
    sala.current = s;
    s.entrar();
  }

  return (
    <div className="grid gap-3 text-sm" data-testid="visita-grupo" data-estado={estado} data-pessoas={pessoas.length}>
      {estado === 'fora' || estado === 'cheia' ? (
        <>
          <p className="text-suave">Mande este mesmo link para a família: quem abrir entra junto, cada um com seu boneco, e vocês conversam por voz.</p>
          {estado === 'cheia' && <p className="text-perigo">A visita está cheia (até 6 pessoas) ou caiu. Tente de novo.</p>}
          <label className="grid gap-1">
            <span>Seu nome na visita</span>
            <input value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} className="rounded-lg border border-borda bg-superficie px-3 py-2" placeholder="Ex.: Ana" />
          </label>
          <Botao type="button" disabled={!pronto} onClick={entrar}>
            Entrar na visita em grupo
          </Botao>
        </>
      ) : (
        <>
          <p>
            {estado === 'conectando' ? 'Entrando…' : pessoas.length ? `Com você: ${pessoas.map((p) => `${p.nome}${p.voz === 'conectada' ? ' 🔊' : ''}`).join(', ')}.` : 'Só você por enquanto. Mande o link para quem vai junto.'}
          </p>
          <p className="text-xs text-suave">Ande no modo a pé para os outros verem seu boneco.</p>
          <div className="flex flex-wrap gap-2">
            <Botao
              type="button"
              variante="secundario"
              aria-pressed={voz}
              onClick={async () => {
                setErro(null);
                if (voz) {
                  sala.current?.desligarVoz();
                  return setVoz(false);
                }
                const ok = await sala.current?.ligarVoz();
                if (ok) setVoz(true);
                else setErro('Não deu para usar o microfone. Confira a permissão do navegador.');
              }}
            >
              {voz ? 'Desligar o microfone' : 'Ligar o microfone'}
            </Botao>
            <Botao
              type="button"
              variante="secundario"
              onClick={() => {
                sala.current?.sair();
                sala.current = null;
                setVoz(false);
                viewer.current?.definirOutros([]);
              }}
            >
              Sair da visita
            </Botao>
          </div>
          {erro && <p className="text-perigo">{erro}</p>}
        </>
      )}
    </div>
  );
}
