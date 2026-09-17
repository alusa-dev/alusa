import { afterEach, describe, expect, it, vi } from 'vitest';

import { isTestRouteEnabled } from '@/lib/security/runtime-guards';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  E2E_SERVER_MODE: process.env.E2E_SERVER_MODE,
  PLAYWRIGHT_TEST: process.env.PLAYWRIGHT_TEST,
  TEST_ROUTES_ENABLED: process.env.TEST_ROUTES_ENABLED,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('runtime test-route guard', () => {
  it('mantém fixtures desabilitadas no runtime de produção normal', () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.TEST_ROUTES_ENABLED = 'true';
    delete process.env.E2E_SERVER_MODE;
    delete process.env.PLAYWRIGHT_TEST;

    expect(isTestRouteEnabled()).toBe(false);
  });

  it('permite fixtures somente no production-like E2E explicitamente isolado', () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.E2E_SERVER_MODE = 'production';
    process.env.PLAYWRIGHT_TEST = 'true';
    process.env.TEST_ROUTES_ENABLED = 'true';

    expect(isTestRouteEnabled()).toBe(true);
  });
});
