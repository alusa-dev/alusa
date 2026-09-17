import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

function loadEnvFile(filePath: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // noop
  }
}

const configDir = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.resolve(configDir, '../../.env.teste'));
loadEnvFile(path.resolve(configDir, '../../.env.test'));
loadEnvFile(path.resolve(configDir, '../../.env.local'));
loadEnvFile(path.resolve(configDir, '.env.local'));

if (!process.env.DATABASE_URL && process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

const port = process.env.PLAYWRIGHT_PORT ?? '3001';
const baseURL = `http://localhost:${port}`;
const useProductionServer = process.env.E2E_SERVER_MODE === 'production';
const configuredPlaywrightHeap = process.env.PLAYWRIGHT_NODE_MAX_OLD_SPACE_SIZE;
const nodeMaxOldSpaceSize = /^\d+$/.test(configuredPlaywrightHeap ?? '')
  ? configuredPlaywrightHeap
  : process.env.CI
    ? '4096'
    : '8192';

export default defineConfig({
  testDir: './',
  // Permite rodar qualquer *.spec.ts dentro de e2e/ ou tests/e2e/
  testMatch: ['e2e/**/*.spec.ts', 'tests/e2e/**/*.spec.ts'],
  // Os fixtures de integração resetam o banco compartilhado entre os testes;
  // um único worker evita corridas destrutivas tanto localmente quanto no CI.
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.SKIP_WEB_SERVER === 'true' ? undefined : {
      command:
        'node -e "require(\'fs\').rmSync(process.env.NEXT_DIST_DIR || \'.next\', { recursive: true, force: true })" && ' +
        'pnpm -C ../.. prisma:generate && ' +
        `pnpm -C ../.. exec turbo run build --filter=${useProductionServer ? '@alusa/web' : '@alusa/web^...'} && ` +
      `cross-env NODE_OPTIONS=--max-old-space-size=${nodeMaxOldSpaceSize} NEXT_TELEMETRY_DISABLED=1 ` +
      (useProductionServer ? `node ../../scripts/e2e/serve-production.mjs --port ${port}` : `next dev --webpack -p ${port}`),
    url: baseURL,
    timeout: useProductionServer ? 300_000 : 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: useProductionServer ? 'production' : 'development',
      PORT: port,
      TEST_ROUTES_ENABLED: 'true',
      PLAYWRIGHT_TEST: 'true',
      PAYMENTS_PROVIDER_MODE: 'mock',
      // Never let the local developer Resend key escape into E2E runs. The
      // transactional email adapter then exercises its deterministic log
      // fallback and the suite remains offline.
      RESEND_API_KEY: '',
      ASAAS_WEBHOOK_AUTH_TOKEN_SECRET: process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET ?? 'test-webhook-secret',
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? '',
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? 'testsecret',
      CRON_SECRET: process.env.CRON_SECRET ?? 'test-cron-secret',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? '',
      NEXT_DIST_DIR: '.next-playwright',
      ...(useProductionServer ? {
        RLS_RUNTIME_ENABLED: process.env.RLS_RUNTIME_ENABLED ?? 'true',
        DATABASE_RLS_URL: process.env.DATABASE_RLS_URL ?? '',
        ASAAS_REDIS_ENABLED: 'true',
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ?? '',
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
        FIN_WEBHOOK_INLINE_DRAIN: 'false',
        FIN_WEBHOOK_SYNC_OVERRIDE: 'false',
        ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS: 'true',
        ASAAS_WEBHOOK_IP_CHECK: 'strict',
        ASAAS_WEBHOOK_PUBLIC_BASE_URL: baseURL,
        CACHE_LAYER_ENABLED: 'true',
        REDIS_CACHE_ENABLED: 'true',
        ASAAS_DISTRIBUTED_GET_LIMIT_ENABLED: 'true',
        // O editor expõe o bridge somente para este build E2E isolado; o
        // runtime de produção normal não recebe NEXT_PUBLIC_E2E.
        NEXT_PUBLIC_E2E: 'true',
        E2E_REDIS_EMULATOR: process.env.E2E_REDIS_EMULATOR ?? 'false',
      } : {}),
    },
  },
});
