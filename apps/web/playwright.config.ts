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

export default defineConfig({
  testDir: './',
  // Permite rodar qualquer *.spec.ts dentro de e2e/ ou tests/e2e/
  testMatch: ['e2e/**/*.spec.ts', 'tests/e2e/**/*.spec.ts'],
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
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'development',
      PORT: port,
      TEST_ROUTES_ENABLED: 'true',
      PLAYWRIGHT_TEST: 'true',
      PAYMENTS_PROVIDER_MODE: 'mock',
      ASAAS_WEBHOOK_AUTH_TOKEN_SECRET: process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET ?? 'test-webhook-secret',
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? '',
      NEXTAUTH_URL: baseURL,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? 'testsecret',
      CRON_SECRET: process.env.CRON_SECRET ?? 'test-cron-secret',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? '',
    },
  },
});
