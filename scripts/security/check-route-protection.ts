import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'apps/web/lib/security/route-protection-registry.ts'), 'utf8');
const required = [
  "'/api/jobs/'",
  "'/api/observability/web-vitals'",
  "'/api/internal/rls-health'",
  "'/api/developer/auth/'",
  "'/api/global-admin/auth/'",
  "'CRON_SECRET'",
  "'WEBHOOK_TOKEN'",
  "'GLOBAL_ADMIN'",
  "'DEVELOPER_MFA'",
];

const missing = required.filter((token) => !source.includes(token));
if (missing.length > 0) {
  console.error('[security] Registry de protecao de rotas incompleto:');
  for (const token of missing) console.error(`- ${token}`);
  process.exit(1);
}

console.log('[security] OK: registry de protecao de rotas cobre rotas criticas.');
