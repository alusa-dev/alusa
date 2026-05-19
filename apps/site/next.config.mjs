import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = join(siteRoot, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Monorepo: trace dependencies from workspace root (Vercel + local builds).
  outputFileTracingRoot: monorepoRoot,
  images: {
    formats: ['image/avif', 'image/webp']
  }
};

export default nextConfig;
