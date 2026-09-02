import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'apps/web/lib/security/route-protection-registry.ts'), 'utf8');
const adminProxy = readFileSync(join(process.cwd(), 'apps/admin/proxy.ts'), 'utf8');
const required = [
  "'/api/jobs/'",
  "'/api/observability/web-vitals'",
  "'/api/internal/rls-health'",
  "'CRON_SECRET'",
  "'WEBHOOK_TOKEN'",
];

const missing = required.filter((token) => !source.includes(token));
if (missing.length > 0) {
  console.error('[security] Registry de protecao de rotas incompleto:');
  for (const token of missing) console.error(`- ${token}`);
  process.exit(1);
}

for (const token of ["'/login'", "'__Host-alusa_admin_session'", "'alusa.admin.session'"]) {
  if (!adminProxy.includes(token)) {
    console.error(`[security] Proxy do Admin sem protecao esperada: ${token}`);
    process.exit(1);
  }
}

console.log('[security] OK: web registry e admin proxy cobrem rotas criticas.');
