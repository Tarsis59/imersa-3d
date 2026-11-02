import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // o selo do modo dev cobria o 3D nas capturas e nos testes visuais (erros continuam aparecendo)
  devIndicators: false,
  // pacote do monorepo em TypeScript, sem build próprio
  transpilePackages: ['@imersa/viewer'],
  // o DXF de um loteamento grande passa de 1 MB (o limite padrão das ações do servidor)
  experimental: { serverActions: { bodySizeLimit: '16mb' } },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // microfone só do próprio site: voz da visita em grupo e comandos falados na Vitrine (Plano 11)
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
