import { ImageResponse } from 'next/og';
import { buscarPortal } from '@/lib/portal';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Visita 3D do empreendimento';

/** Imagem da prévia do link no WhatsApp: empresa, empreendimento, cidade e consultora (gerada aqui, sem serviço externo). */
export default async function Imagem({ params }: { params: Promise<{ token: string }> }) {
  const r = await buscarPortal((await params).token);
  const p = r?.status === 200 ? r.dados : null;
  const local = p ? [p.projeto.cidade, p.projeto.uf].filter(Boolean).join(' – ') : '';
  const disponiveis = p ? p.unidades.filter((u) => u.status === 'disponivel').length : 0;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)', color: 'white' }}>
        <div style={{ display: 'flex', fontSize: 34, opacity: 0.85 }}>{p?.empresa.nome ?? 'Imersa 3D'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', fontSize: 30, color: '#93c5fd', letterSpacing: 4 }}>VISITA EM 3D</div>
          <div style={{ display: 'flex', fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>{p ? `${p.projeto.nome}` : 'Link indisponível'}</div>
          {p && (
            <div style={{ display: 'flex', fontSize: 40, opacity: 0.9 }}>
              {p.predio.nome}
              {local ? ` · ${local}` : ''}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 30, opacity: 0.9 }}>
          <span>{p ? `Atendimento: ${p.consultora.nome}` : ''}</span>
          <span>{p ? `${disponiveis} ${disponiveis === 1 ? 'unidade disponível' : 'unidades disponíveis'}` : ''}</span>
        </div>
      </div>
    ),
    size,
  );
}
