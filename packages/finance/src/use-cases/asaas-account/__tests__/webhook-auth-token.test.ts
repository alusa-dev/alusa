import { describe, expect, it, beforeEach } from 'vitest';

import {
  deriveWebhookAuthToken,
  getExplicitWebhookAuthToken,
  hasWebhookAuthTokenConfig,
  hashWebhookAuthToken,
  resolveWebhookAuthToken,
} from '../webhook-auth-token';

describe('webhook-auth-token', () => {
  beforeEach(() => {
    delete process.env.ASAAS_WEBHOOK_AUTH_TOKEN;
    process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET = 'unit-test-secret';
  });

  it('deriva token determinístico por financeProfileId', () => {
    const token1 = deriveWebhookAuthToken('fp_1');
    const token2 = deriveWebhookAuthToken('fp_1');
    const token3 = deriveWebhookAuthToken('fp_2');

    expect(token1).toBe(token2);
    expect(token1).not.toBe(token3);
  });

  it('gera hash estável', () => {
    const token = deriveWebhookAuthToken('fp_1');
    const h1 = hashWebhookAuthToken(token);
    const h2 = hashWebhookAuthToken(token);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('ASAAS_WEBHOOK_AUTH_TOKEN global não afeta derivação por tenant', () => {
    // Token global não deve ser usado na derivação — causaria colisão de hash (@unique)
    process.env.ASAAS_WEBHOOK_AUTH_TOKEN = 'whsec_explicit_token';

    expect(getExplicitWebhookAuthToken()).toBe('whsec_explicit_token');
    expect(hasWebhookAuthTokenConfig()).toBe(true);
    // deriveWebhookAuthToken deve ignorar o token global e usar HMAC por tenant
    expect(deriveWebhookAuthToken('fp_1')).not.toBe('whsec_explicit_token');
    expect(deriveWebhookAuthToken('fp_2')).not.toBe('whsec_explicit_token');
    // tokens por tenant devem ser distintos entre si
    expect(deriveWebhookAuthToken('fp_1')).not.toBe(deriveWebhookAuthToken('fp_2'));
  });

  it('usa ASAAS_WEBHOOK_AUTH_TOKEN explícito no token esperado do webhook', () => {
    process.env.ASAAS_WEBHOOK_AUTH_TOKEN = 'whsec_explicit_token';

    expect(resolveWebhookAuthToken('fp_1')).toBe('whsec_explicit_token');
    expect(resolveWebhookAuthToken('fp_2')).toBe('whsec_explicit_token');
  });
});
