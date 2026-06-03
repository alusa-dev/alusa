import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { withSentryConfig } from '@sentry/nextjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const scriptSrc = [
  "script-src 'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV === 'production' ? [] : ["'unsafe-eval'"]),
  'https://va.vercel-scripts.com',
  'https://vercel.live',
].join(' ');

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "frame-src 'self' blob:",
      "child-src 'self' blob:",
      "form-action 'self'",
      scriptSrc,
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "media-src 'self' blob:",
      'upgrade-insecure-requests',
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
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
    '@alusa/finance',
    'zod',
  ],
  transpilePackages: [
    '@alusa/lib',
    '@alusa/ui',
    '@alusa/domain',
    '@alusa/shared',
    'konva',
  ],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@heroicons/react',
      '@radix-ui/react-icons',
      '@fullcalendar/react',
      '@fullcalendar/daygrid',
      '@fullcalendar/timegrid',
      '@fullcalendar/interaction',
      'date-fns',
    ],
  },
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
        source: '/:path*',
        headers: securityHeaders,
      },
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
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      Object.defineProperty(config, 'devtool', {
        get() { return 'source-map'; },
        set() {}
      });
    }
    // Alias direto para o pacote do monorepo (fallback robusto para pnpm)
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['@alusa/asaas'] = resolvePath(__dirname, '../../packages/asaas/dist/index.js');
    const libSrc = resolvePath(__dirname, '../../packages/lib/src');
    const libDistSrc = resolvePath(__dirname, '../../packages/lib/dist');
    const libBase = dev ? libSrc : libDistSrc;
    config.resolve.alias['@alusa/lib/cpf-cnpj'] = resolvePath(
      libBase,
      dev ? 'utils/cpf-cnpj.ts' : 'utils/cpf-cnpj.js',
    );
    config.resolve.alias['@alusa/lib/date-only'] = resolvePath(
      libBase,
      dev ? 'utils/date-only.ts' : 'utils/date-only.js',
    );
    config.resolve.alias['@alusa/lib/errors/asaas-customer-ensure-error'] = resolvePath(
      libBase,
      dev ? 'errors/asaas-customer-ensure-error.ts' : 'errors/asaas-customer-ensure-error.js',
    );
    config.resolve.alias['@alusa/lib/client'] = resolvePath(libBase, dev ? 'client.ts' : 'client.js');
    config.resolve.alias['@alusa/lib/events/map'] = resolvePath(libBase, 'events/map');
    config.resolve.alias['@alusa/lib/events'] = resolvePath(libBase, 'events');
    config.resolve.alias['@alusa/lib/prisma'] = resolvePath(libBase, dev ? 'prisma.ts' : 'prisma.js');
    config.resolve.alias['@alusa/lib/server'] = resolvePath(libBase, dev ? 'server.ts' : 'server.js');
    config.resolve.alias['@alusa/lib'] = resolvePath(libBase, dev ? 'index.ts' : 'index.js');
    if (!isServer) {
      config.resolve.alias['@alusa/finance$'] = resolvePath(
        __dirname,
        'lib/stubs/server-only-finance.ts',
      );
      config.resolve.alias['node:crypto'] = false;
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
      };
    }
    // konva: externaliza canvas (não disponível no Edge/SSR).
    config.externals = [...(Array.isArray(config.externals) ? config.externals : []), { canvas: 'canvas' }];
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
