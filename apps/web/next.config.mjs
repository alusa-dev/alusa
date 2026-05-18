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
  // Sentry no servidor via require() real — evita vendor-chunks webpack desencontrados após mudanças de deps / cache .next
  serverExternalPackages: [
    '@sentry/nextjs',
    '@sentry/node',
    '@sentry/node-core',
    '@sentry/core',
    '@sentry/opentelemetry',
    '@sentry/react',
    '@sentry/browser',
  ],
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
    const libDistSrc = resolvePath(__dirname, '../../packages/lib/dist/lib/src');
    config.resolve.alias['@alusa/lib/cpf-cnpj'] = resolvePath(libDistSrc, 'utils/cpf-cnpj.js');
    config.resolve.alias['@alusa/lib/client'] = resolvePath(libDistSrc, 'client.js');
    config.resolve.alias['@alusa/lib/prisma'] = resolvePath(libDistSrc, 'prisma.js');
    config.resolve.alias['@alusa/lib/server'] = resolvePath(libDistSrc, 'server.js');
    config.resolve.alias['@alusa/lib'] = resolvePath(libDistSrc, 'index.js');
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
