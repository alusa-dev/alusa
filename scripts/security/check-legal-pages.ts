import { existsSync } from 'node:fs';
import { join } from 'node:path';

const pages = [
  'privacidade',
  'termos',
  'cookies',
  'seguranca',
  'suboperadores',
  'dpa',
  'direitos-lgpd',
  'direitos-lgpd/solicitar',
];

const missing = pages.filter((page) => !existsSync(join(process.cwd(), 'apps/web/app/(public)', page, 'page.tsx')));

if (missing.length > 0) {
  console.error('[security] Paginas legais ausentes:');
  for (const page of missing) console.error(`- /${page}`);
  process.exit(1);
}

console.log('[security] OK: paginas legais publicas existem.');
