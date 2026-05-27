import { spawnSync } from 'node:child_process';

const scripts = [
  'check-rls-policies.ts',
  'check-route-protection.ts',
  'check-sensitive-fields.ts',
  'check-no-twilio.ts',
  'check-no-card-token.ts',
  'check-legal-pages.ts',
  'check-cookie-consent.ts',
];

for (const script of scripts) {
  const result = spawnSync('tsx', [`scripts/security/${script}`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('[security] OK: todas as verificacoes passaram.');
