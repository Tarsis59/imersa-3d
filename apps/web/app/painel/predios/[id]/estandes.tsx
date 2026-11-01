'use client';
import { useState, useTransition } from 'react';
import { Aviso, Botao, Campo } from '@/components/ui';
import { useAtualizarEnquanto } from '@/lib/atualizacao';
import type { Estande } from '@/lib/tipos';

const ROTULO = { online: 'Online', offline: 'Offline', desativado: 'Desativado' } as const;
const COR = { online: 'bg-emerald-600 text-white', offline: 'bg-slate-500 text-white', desativado: 'border border-borda text-suave' } as const;
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Atalho do Windows que abre o estande em tela cheia (modo quiosque) ao ligar o PC: Chrome se houver, senão o Edge
 * (que vem no Windows). Linhas com CRLF, como o Prompt de Comando espera.
 */
export function atalhoWindows(url: string): string {
  return [
    '@echo off',
    'rem Estande Imersa 3D: abre a Vitrine em tela cheia (modo quiosque).',
    'rem Para abrir sozinho ao ligar o PC: Windows + R, digite shell:startup e coloque este arquivo na pasta que abrir.',
    `set URL=${url}`,
    'set CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
    'if not exist "%CHROME%" set CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
    'if exist "%CHROME%" (',
    '  start "" "%CHROME%" --kiosk --noerrdialogs --disable-session-crashed-bubble --no-first-run --disable-features=TranslateUI --overscroll-history-navigation=0 "%URL%"',
    ') else (',
    '  start "" msedge --kiosk "%URL%" --edge-kiosk-type=fullscreen --no-first-run',
    ')',
    '',
  ].join('\r\n');
}

function baixarTexto(nome: string, texto: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/octet-stream' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/**
 * Estandes de vendas: o PC com tela touch do estande abre a Vitrine em tela cheia, com apresentação automática, QR
 * code para o visitante levar no celular e status ao vivo. Daqui a gestão vê se está ligado e manda recarregar.
 */
export function Estandes({
  predioId,
  estandes,
  temModelo,
  criar,
  comandar,
}: {
  predioId: string;
  estandes: Estande[];
  temModelo: boolean;
  criar: (nome: string) => Promise<{ url?: string; erro?: string }>;
  comandar: (estandeId: string, comando: 'recarregar' | 'desativar') => Promise<{ erro?: string }>;
}) {
  const [nome, setNome] = useState('');
  const [novo, setNovo] = useState<{ nome: string; url: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  // online/offline muda sozinho: confere a cada minuto enquanto houver estande ativo
  useAtualizarEnquanto(
    estandes.some((e) => e.status !== 'desativado'),
    60_000,
  );

  const enviar = () =>
    iniciar(async () => {
      setErro(null);
      const r = await criar(nome.trim());
      if (r.erro || !r.url) return setErro(r.erro ?? 'Não foi possível criar o estande.');
      setNovo({ nome: nome.trim(), url: r.url });
      setNome('');
      setCopiado(false);
    });
  const executar = (id: string, comando: 'recarregar' | 'desativar') =>
    iniciar(async () => {
      setErro(null);
      setConfirmando(null);
      const r = await comandar(id, comando);
      if (r.erro) setErro(r.erro);
    });

  return (
    <div className="grid gap-5 text-sm" data-testid="estandes">
      <p className="text-suave">
        Transforme o PC do estande de vendas (com TV ou tela touch) numa Vitrine 3D em tela cheia: quando ninguém está mexendo, a câmera gira sozinha e mostra
        as unidades disponíveis; quem chega toca na tela e explora; um QR code leva o empreendimento para o celular do visitante. Vendas e reservas aparecem na
        hora.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <div className="min-w-56 flex-1">
          <Campo id="nome-estande" rotulo="Nome do estande" placeholder="Ex.: Estande da Av. Paulista" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
        </div>
        <Botao type="submit" disabled={ocupado || !nome.trim()}>
          Criar estande
        </Botao>
      </form>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {novo && (
        <div className="grid gap-3 rounded-xl border border-acento/40 bg-fundo p-4" data-testid="estande-novo">
          <p className="font-semibold">Estande “{novo.nome}” criado. Guarde o endereço: por segurança, ele só aparece agora.</p>
          <code data-testid="endereco-estande" className="break-all rounded-lg bg-superficie px-3 py-2 text-xs">
            {novo.url}
          </code>
          <div className="flex flex-wrap gap-2">
            <Botao
              type="button"
              variante="secundario"
              onClick={() => {
                void navigator.clipboard?.writeText(novo.url).then(() => setCopiado(true));
              }}
            >
              {copiado ? 'Copiado' : 'Copiar endereço'}
            </Botao>
            <Botao type="button" variante="secundario" onClick={() => baixarTexto(`estande-${novo.nome.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.bat`, atalhoWindows(novo.url))}>
              Baixar atalho para Windows
            </Botao>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-suave">
            <li>No PC do estande, baixe o atalho (ou abra o endereço no Chrome ou no Edge).</li>
            <li>Dê dois cliques: a Vitrine abre em tela cheia, sem barra do navegador.</li>
            <li>
              Para abrir sozinho ao ligar o PC: tecla Windows + R, digite <code>shell:startup</code> e coloque o atalho na pasta que abrir.
            </li>
            <li>Para sair da tela cheia no PC: Alt + F4.</li>
          </ol>
        </div>
      )}

      {estandes.length > 0 && (
        <ul className="grid gap-2" data-testid="lista-estandes">
          {estandes.map((e) => (
            <li key={e.id} data-status-estande={e.status} className="grid gap-2 rounded-xl border border-borda p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <strong>{e.nome}</strong>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${COR[e.status]}`}>{ROTULO[e.status]}</span>
                  {e.recarregarPendente && <span className="text-xs text-suave">recarregando no próximo sinal…</span>}
                </span>
                {e.status !== 'desativado' && (
                  <span className="flex gap-2">
                    <Botao type="button" variante="secundario" disabled={ocupado} onClick={() => executar(e.id, 'recarregar')}>
                      Recarregar
                    </Botao>
                    {confirmando === e.id ? (
                      <Botao type="button" variante="perigo" disabled={ocupado} onClick={() => executar(e.id, 'desativar')}>
                        Confirmar desativação
                      </Botao>
                    ) : (
                      <Botao type="button" variante="secundario" disabled={ocupado} onClick={() => setConfirmando(e.id)}>
                        Desativar
                      </Botao>
                    )}
                  </span>
                )}
              </div>
              <p className="text-xs text-suave">
                {e.ultimoSinalEm ? `Último sinal: ${quando(e.ultimoSinalEm)}` : 'Ainda não foi aberto no PC do estande'}
                {e.info.fps !== undefined && ` · ${e.info.fps} quadros/s`}
                {e.info.largura && e.info.altura ? ` · tela ${e.info.largura}×${e.info.altura}` : ''}
                {e.status === 'online' && e.info.apresentando !== undefined && (e.info.apresentando ? ' · em apresentação' : ' · alguém está explorando')}
              </p>
              <p className="text-xs">
                <span data-testid="interacoes-estande">{e.interacoes}</span> visitantes mexeram na tela · {e.visitasQr} abriram pelo QR · {e.leads} pedidos de contato
              </p>
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-xl border border-borda p-3">
        <summary className="cursor-pointer font-semibold">Estande em Unreal Engine (realismo máximo)</summary>
        <div className="mt-3 grid gap-2 text-suave">
          <p>
            Para um estande com o Unreal Engine 5 (precisa de PC com placa NVIDIA RTX), o projeto do Unreal usa este pacote: o empreendimento com localização
            e norte, as unidades ligadas às peças do modelo e o modelo sem compressão. Na hora de rodar, ele usa o endereço de um estande acima para receber o
            status ao vivo.
          </p>
          <span className="flex flex-wrap gap-2">
            <a href={`/painel/predios/${predioId}/pacote-unreal`} className="rounded-lg border border-borda bg-superficie px-3 py-2 font-semibold text-texto hover:bg-fundo">
              Baixar dados (JSON)
            </a>
            {temModelo && (
              <a href={`/painel/predios/${predioId}/pacote-unreal/modelo`} className="rounded-lg border border-borda bg-superficie px-3 py-2 font-semibold text-texto hover:bg-fundo">
                Baixar modelo (GLB)
              </a>
            )}
          </span>
        </div>
      </details>
    </div>
  );
}
