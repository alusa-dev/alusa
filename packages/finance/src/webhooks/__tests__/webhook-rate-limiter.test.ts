import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/asaas', () => ({
  checkAsaasDistributedRateLimit: vi.fn(async () => null),
}));

import { buildWebhookRateLimitKey, WebhookRateLimiter } from '../webhook-rate-limiter';

describe('webhook-rate-limiter', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('preserva chave por IP por padrão', () => {
    delete process.env.ASAAS_WEBHOOK_AUTH_SCOPED_RATE_LIMIT;

    expect(buildWebhookRateLimitKey({
      ip: '10.0.0.1',
      contaId: 'conta-1',
      tokenHashPrefix: 'abcdef123456',
    })).toBe('ip:10.0.0.1');
  });

  it('usa escopo complementar quando flag está ativa sem expor token bruto', () => {
    process.env.ASAAS_WEBHOOK_AUTH_SCOPED_RATE_LIMIT = 'true';

    const key = buildWebhookRateLimitKey({
      ip: '10.0.0.1',
      contaId: 'conta-1',
      tokenHashPrefix: 'abcdef123456',
    });

    expect(key).toBe('conta:conta-1:token:abcdef123456:ip:10.0.0.1');
    expect(key).not.toContain('raw-token');
  });

  it('bloqueia somente após exceder limite', () => {
    const limiter = new WebhookRateLimiter({ maxRequests: 2, windowMs: 60_000 });

    expect(limiter.check('ip:1').allowed).toBe(true);
    expect(limiter.check('ip:1').allowed).toBe(true);
    expect(limiter.check('ip:1').allowed).toBe(false);
  });

  it('expõe fallback local como degradado quando Redis não está configurado', async () => {
    const limiter = new WebhookRateLimiter({ maxRequests: 2, windowMs: 60_000 });

    const result = await limiter.checkAsync('ip:1');

    expect(result.backend).toBe('memory');
    expect(result.degraded).toBe(true);
    expect(result.allowed).toBe(true);
  });
});
