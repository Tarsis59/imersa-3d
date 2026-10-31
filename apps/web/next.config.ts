import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // o selo do modo dev cobria o 3D nas capturas e nos testes visuais (erros continuam aparecendo)
  devIndicators: false,
  // pacote do monorepo em TypeScript, sem build próprio
  transpilePackages: ['@imersa/viewer'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
