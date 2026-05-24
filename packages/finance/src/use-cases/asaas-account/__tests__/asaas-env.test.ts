import { afterEach, describe, expect, it } from 'vitest';

import {
  canonicalizePublicBaseUrl,
  resolveWebhookUrl,
  resolveWebhookUrlOrNull,
} from '../asaas-env';

const originalNodeEnv = process.env.NODE_ENV;
const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalWebhookBaseUrl = process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL;
const originalVitest = process.env.VITEST;
const originalVitestWorkerId = process.env.VITEST_WORKER_ID;
const originalVitestPoolId = process.env.VITEST_POOL_ID;

describe('asaas-env webhook url', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    if (originalNextPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;

    if (originalWebhookBaseUrl === undefined) delete process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL;
    else process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL = originalWebhookBaseUrl;

    if (originalVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = originalVitest;

    if (originalVitestWorkerId === undefined) delete process.env.VITEST_WORKER_ID;
    else process.env.VITEST_WORKER_ID = originalVitestWorkerId;

    if (originalVitestPoolId === undefined) delete process.env.VITEST_POOL_ID;
    else process.env.VITEST_POOL_ID = originalVitestPoolId;
  });

  it('retorna null em desenvolvimento local quando NEXT_PUBLIC_APP_URL aponta para localhost', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    delete process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL;
    delete process.env.VITEST;
    delete process.env.VITEST_WORKER_ID;
    delete process.env.VITEST_POOL_ID;

    expect(resolveWebhookUrlOrNull()).toBeNull();
    expect(() => resolveWebhookUrl()).toThrow('NEXT_PUBLIC_APP_URL deve usar https.');
  });

  it('prioriza ASAAS_WEBHOOK_PUBLIC_BASE_URL pública quando configurada', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL = 'https://public.example.com';

    expect(resolveWebhookUrlOrNull()).toBe('https://public.example.com/api/webhooks/asaas');
    expect(resolveWebhookUrl()).toBe('https://public.example.com/api/webhooks/asaas');
  });

  it('canonicaliza dominios publicos do site para app.alusa.app', () => {
    expect(canonicalizePublicBaseUrl('https://alusa.app')).toBe('https://app.alusa.app');
    expect(canonicalizePublicBaseUrl('https://alusa.app/')).toBe('https://app.alusa.app');
    expect(canonicalizePublicBaseUrl('https://www.alusa.app')).toBe('https://app.alusa.app');

    process.env.NODE_ENV = 'production';
    delete process.env.VITEST;
    delete process.env.VITEST_WORKER_ID;
    delete process.env.VITEST_POOL_ID;
    process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL = 'https://alusa.app';

    expect(resolveWebhookUrl()).toBe('https://app.alusa.app/api/webhooks/asaas');
  });
});