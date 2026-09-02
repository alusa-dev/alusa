import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(appDir, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@alusa/admin-auth', '@alusa/database', '@alusa/lib'],
  turbopack: {
    root: workspaceRoot,
    resolveAlias: {
      '@alusa/admin-auth': '../../packages/admin-auth/src/index.ts',
      '@alusa/admin-auth/*': '../../packages/admin-auth/src/*.ts',
      '@alusa/database': '../../packages/database/src/index.ts',
      '@alusa/database/*': '../../packages/database/src/*.ts',
      '@alusa/finance': '../../packages/finance/dist/index.js',
      '@alusa/finance/*': '../../packages/finance/dist/*.js',
      '@alusa/lib': '../../packages/lib/src/index.ts',
      '@alusa/lib/*': '../../packages/lib/src/*.ts',
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@alusa/finance$': resolve(workspaceRoot, 'packages/finance/dist/index.js'),
    };
    return config;
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Cache-Control', value: 'no-store' },
      ],
    }];
  },
};

export default nextConfig;
