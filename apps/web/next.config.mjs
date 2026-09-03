import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { withSentryConfig } from '@sentry/nextjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const turbopackRoot = resolvePath(__dirname, '../..');
const packageDistPath = (packageName, relativePath) =>
  `../../packages/${packageName}/dist/${relativePath}`;
const packageSourcePath = (packageName, relativePath) =>
  `../../packages/${packageName}/src/${relativePath}`;
const webSourcePath = (relativePath) => `./${relativePath}`;
// Em desenvolvimento, o app deve consumir o código-fonte dos pacotes internos.
// Caso contrário o Turbopack pode manter um artefato dist antigo em memória e a
// API passa a responder com serializadores desatualizados.
const useWorkspaceSources = process.env.NODE_ENV !== 'production';

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
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? '',
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? '',
  },
  // Permite que o Playwright use um diretório de desenvolvimento isolado sem
  // disputar o lock do servidor local do workspace.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
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
    '@alusa/admin-auth',
    '@alusa/lib',
    '@alusa/ui',
    '@alusa/domain',
    '@alusa/shared',
    'konva',
  ],
  turbopack: {
    // Resolve workspace packages from the monorepo root. Without an explicit
    // root, aliases that point outside apps/web are treated as unavailable by
    // Turbopack even when their dist files exist.
    root: turbopackRoot,
    resolveAlias: {
      '@alusa/admin-auth': packageSourcePath('admin-auth', 'index.ts'),
      '@alusa/admin-auth/*': packageSourcePath('admin-auth', '*'),
      '@alusa/asaas': packageDistPath('asaas', 'index.js'),
      '@alusa/asaas/*': packageDistPath('asaas', '*.js'),
      '@alusa/database': packageDistPath('database', 'index.js'),
      '@alusa/database/*': packageDistPath('database', '*.js'),
      '@alusa/domain': packageDistPath('domain', 'index.js'),
      '@alusa/domain/*': packageDistPath('domain', '*.js'),
      '@alusa/finance': {
        browser: webSourcePath('lib/stubs/server-only-finance.ts'),
        default: packageDistPath('finance', 'index.js'),
      },
      '@alusa/finance/*': packageDistPath('finance', '*.js'),
      '@alusa/lib': useWorkspaceSources
        ? packageSourcePath('lib', 'index.ts')
        : packageDistPath('lib', 'index.js'),
      '@alusa/lib/*': useWorkspaceSources
        ? packageSourcePath('lib', '*')
        : packageDistPath('lib', '*.js'),
      '@alusa/platform-billing': packageDistPath('platform-billing', 'index.js'),
      '@alusa/platform-billing/*': packageDistPath('platform-billing', '*.js'),
      '@alusa/shared': packageDistPath('shared', 'index.js'),
      '@alusa/shared/*': packageDistPath('shared', '*.js'),
      '@alusa/stripe': packageDistPath('stripe', 'index.js'),
      '@alusa/stripe/*': packageDistPath('stripe', '*.js'),
      // O build do pacote UI produz artefatos aninhados por causa dos paths
      // herdados do tsconfig raiz; o código-fonte é a resolução canônica para
      // os subpaths usados pelo app e já está em transpilePackages.
      '@alusa/ui': packageSourcePath('ui', 'index.ts'),
      '@alusa/ui/*': packageSourcePath('ui', '*'),
      // Estes subpaths não seguem o mapeamento direto dist/<subpath>.js:
      // no pacote lib eles são emitidos em utils/ ou na raiz.
      '@alusa/lib/cpf-cnpj': useWorkspaceSources
        ? packageSourcePath('lib', 'utils/cpf-cnpj.ts')
        : packageDistPath('lib', 'utils/cpf-cnpj.js'),
      '@alusa/lib/date-only': useWorkspaceSources
        ? packageSourcePath('lib', 'utils/date-only.ts')
        : packageDistPath('lib', 'utils/date-only.js'),
      '@alusa/lib/zod-error-map': useWorkspaceSources
        ? packageSourcePath('lib', 'zod-error-map.ts')
        : packageDistPath('lib', 'zod-error-map.js'),
      '@alusa/lib/security/rate-limit': useWorkspaceSources
        ? packageSourcePath('lib', 'security/rate-limit.ts')
        : packageDistPath('lib', 'security/rate-limit.js'),
    },
  },
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
      {
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/integrations/:path*',
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
      // Evita crescimento ilimitado do cache em memória durante sessões longas de `next dev`.
      if (config.cache && typeof config.cache === 'object') {
        config.cache.maxMemoryGenerations = 1;
      }
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
    config.resolve.alias['@alusa/lib/security/rate-limit'] = resolvePath(
      libBase,
      dev ? 'security/rate-limit.ts' : 'security/rate-limit.js',
    );
    config.resolve.alias['@alusa/lib/errors/asaas-customer-ensure-error'] = resolvePath(
      libBase,
      dev ? 'errors/asaas-customer-ensure-error.ts' : 'errors/asaas-customer-ensure-error.js',
    );
    config.resolve.alias['@alusa/lib/client'] = resolvePath(libBase, dev ? 'client.ts' : 'client.js');
    config.resolve.alias['@alusa/lib/invite/build-invite-url'] = resolvePath(
      libBase,
      dev ? 'invite/build-invite-url.ts' : 'invite/build-invite-url.js',
    );
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
  // Mantém o upload de sourcemaps focado nos bundles necessários para reduzir
  // o tempo de build sem desativar a observabilidade do Sentry.
  widenClientFileUpload: false,
  // O upload de sourcemaps excede o tempo limite da Vercel neste monorepo;
  // os eventos de runtime continuam sendo enviados normalmente ao Sentry.
  sourcemaps: {
    disable: true,
  },
  tunnelRoute: '/monitoring',
  silent: !process.env.CI,
});
