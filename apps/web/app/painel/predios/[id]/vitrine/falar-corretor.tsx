'use client';
import { useEffect, useState } from 'react';

/** Link do WhatsApp do corretor com a unidade já citada na mensagem (o cliente só aperta enviar). */
export function linkWhatsapp(numero: string, mensagem: string): string {
  return `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(mensagem)}`;
}

/**
 * Falar com o corretor sobre a unidade (Plano 12b): botão no celular e, em tela grande (estande, computador), também
 * o QR, para quem está na frente da tela continuar a conversa no próprio celular.
 */
export function FalarComCorretor({ numero, nomeCorretor, empreendimento, unidade }: { numero: string; nomeCorretor: string; empreendimento: string; unidade: string }) {
  const url = linkWhatsapp(numero, `Olá, ${nomeCorretor}! Vi a unidade ${unidade} do ${empreendimento} em 3D e quero saber mais.`);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void import('qrcode')
      .then((m) => m.toDataURL(url, { margin: 1, width: 220, errorCorrectionLevel: 'M' }))
      .then((d) => vivo && setQr(d))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [url]);
  return (
    <div className="grid gap-2" data-testid="falar-corretor">
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
        Falar com {nomeCorretor} sobre a {unidade}
      </a>
      {qr && (
        <figure className="hidden items-center gap-3 md:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR para falar com ${nomeCorretor} no WhatsApp sobre a unidade ${unidade}`} width={110} height={110} className="rounded bg-white p-1" />
          <figcaption className="text-xs text-suave">Aponte a câmera do celular para continuar no WhatsApp.</figcaption>
        </figure>
      )}
    </div>
  );
}
