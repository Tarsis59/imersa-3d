import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Endereço público do site: a prévia do link no WhatsApp precisa da URL completa da imagem.
// Na Vercel vem do domínio de produção do projeto; fora dela, de SITE_URL.
const SITE_URL =
  process.env.SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');

export const metadata: Metadata = { metadataBase: new URL(SITE_URL), title: 'Imersa 3D', description: 'Plataforma imobiliária 3D' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
