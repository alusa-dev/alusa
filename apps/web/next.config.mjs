import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { withSentryConfig } from '@sentry/nextjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Evita falhas no build devido à configuração ESLint da raiz (fora do workspace)
    ignoreDuringBuilds: true,
  },
  transpilePackages: ['@alusa/lib', '@alusa/ui'],
  async rewrites() {
    return [
      { source: '/auth/login', destination: '/login' },
      { source: '/auth/register', destination: '/register' },
      { source: '/auth/accept', destination: '/accept' },
      { source: '/auth/complete-profile', destination: '/complete-profile' },
      { source: '/auth/confirm-email', destination: '/confirm-email' },
      { source: '/auth/verify-email', destination: '/verify-email' },
      { source: '/auth/forgot-password', destination: '/forgot-password' },
      { source: '/auth/reset-password', destination: '/reset-password' },
    ];
  },
  async headers() {
    return [
      {
        source: '/brand/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Alias direto para o pacote do monorepo (fallback robusto para pnpm)
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['@alusa/asaas'] = resolvePath(__dirname, '../../packages/asaas/dist/index.js');
    config.resolve.alias['@alusa/lib/cpf-cnpj'] = resolvePath(
      __dirname,
      '../../packages/lib/dist/packages/lib/src/utils/cpf-cnpj.js'
    );
    config.resolve.alias['@alusa/lib/client'] = resolvePath(__dirname, '../../packages/lib/dist/client.js');
    config.resolve.alias['@alusa/lib'] = resolvePath(__dirname, '../../packages/lib/dist');
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  org: 'alusa',
  project: 'javascript-nextjs',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
});
