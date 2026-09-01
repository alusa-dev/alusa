import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const layout = readFileSync(join(root, 'apps/web/app/layout.tsx'), 'utf8');
const banner = readFileSync(join(root, 'apps/web/components/legal/CookieConsentBanner.tsx'), 'utf8');
const siteShell = readFileSync(join(root, 'apps/web/features/site/components/layout/SiteShell.tsx'), 'utf8');

if (!layout.includes('CookieConsentBanner') || layout.includes('ConsentAwareAnalytics')) {
  console.error('[security] CookieConsentBanner deve estar no root layout e o Vercel Analytics deve permanecer desabilitado.');
  process.exit(1);
}

if (!banner.includes('analytics: false') || !banner.includes('marketing: false')) {
  console.error('[security] Categorias nao essenciais devem iniciar desativadas.');
  process.exit(1);
}

if (banner.includes("@vercel/analytics") || siteShell.includes('<Analytics') || layout.includes('@vercel/analytics')) {
  console.error('[security] Vercel Analytics nao deve ser carregado neste projeto.');
  process.exit(1);
}

console.log('[security] OK: Vercel Analytics desabilitado e banner de cookies preservado.');
