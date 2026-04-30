import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimitTracker, extractRateLimitHeaders } from './rate-limit-tracker';

describe('RateLimitTracker', () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker();
  });

  describe('update', () => {
    it('deve armazenar info de rate limit', () => {
      tracker.update('/v3/payments', {
        limit: 100,
        remaining: 50,
        resetSeconds: 30,
        capturedAt: Date.now(),
      });

      const info = tracker.get('/v3/payments');
      expect(info).not.toBeNull();
      expect(info!.limit).toBe(100);
      expect(info!.remaining).toBe(50);
    });

    it('deve ignorar info sem dados relevantes', () => {
      tracker.update('/v3/payments', {
        limit: null,
        remaining: null,
        resetSeconds: null,
        capturedAt: Date.now(),
      });

      expect(tracker.get('/v3/payments')).toBeNull();
    });
  });

  describe('isNearLimit', () => {
    it('deve retornar true quando remaining <= threshold', () => {
      tracker.update('/v3/payments', {
        limit: 100,
        remaining: 3,
        resetSeconds: 30,
        capturedAt: Date.now(),
      });

      expect(tracker.isNearLimit('/v3/payments', 5)).toBe(true);
    });

    it('deve retornar false quando remaining > threshold', () => {
      tracker.update('/v3/payments', {
        limit: 100,
        remaining: 50,
        resetSeconds: 30,
        capturedAt: Date.now(),
      });

      expect(tracker.isNearLimit('/v3/payments', 5)).toBe(false);
    });

    it('deve retornar false para endpoint desconhecido', () => {
      expect(tracker.isNearLimit('/v3/unknown')).toBe(false);
    });
  });

  describe('shouldBackoff', () => {
    it('deve retornar backoff=true quando remaining=0', () => {
      tracker.update('/v3/payments', {
        limit: 100,
        remaining: 0,
        resetSeconds: 60,
        capturedAt: Date.now(),
      });

      const result = tracker.shouldBackoff('/v3/payments');
      expect(result.backoff).toBe(true);
      expect(result.waitMs).toBe(60000);
    });

    it('deve retornar backoff=false quando remaining > 0', () => {
      tracker.update('/v3/payments', {
        limit: 100,
        remaining: 10,
        resetSeconds: 60,
        capturedAt: Date.now(),
      });

      const result = tracker.shouldBackoff('/v3/payments');
      expect(result.backoff).toBe(false);
      expect(result.waitMs).toBe(0);
    });

    it('deve retornar backoff=false para endpoint desconhecido', () => {
      const result = tracker.shouldBackoff('/v3/unknown');
      expect(result.backoff).toBe(false);
    });
  });

  describe('snapshot', () => {
    it('deve retornar snapshot de todos os endpoints', () => {
      tracker.update('/v3/payments', { limit: 100, remaining: 50, resetSeconds: 30, capturedAt: Date.now() });
      tracker.update('/v3/customers', { limit: 200, remaining: 150, resetSeconds: 60, capturedAt: Date.now() });

      const snap = tracker.snapshot();
      expect(Object.keys(snap)).toHaveLength(2);
      expect(snap['/v3/payments'].limit).toBe(100);
      expect(snap['/v3/customers'].limit).toBe(200);
    });
  });

  describe('clear', () => {
    it('deve limpar todos os dados', () => {
      tracker.update('/v3/payments', { limit: 100, remaining: 50, resetSeconds: 30, capturedAt: Date.now() });
      tracker.clear();
      expect(tracker.get('/v3/payments')).toBeNull();
    });
  });
});

describe('extractRateLimitHeaders', () => {
  it('deve extrair headers de rate limit', () => {
    const headers = {
      get: (name: string) => {
        const map: Record<string, string> = {
          'ratelimit-limit': '100',
          'ratelimit-remaining': '50',
          'ratelimit-reset': '30',
        };
        return map[name.toLowerCase()] ?? null;
      },
    };

    const info = extractRateLimitHeaders(headers);
    expect(info.limit).toBe(100);
    expect(info.remaining).toBe(50);
    expect(info.resetSeconds).toBe(30);
    expect(info.capturedAt).toBeGreaterThan(0);
  });

  it('deve retornar nulls quando headers ausentes', () => {
    const headers = { get: () => null };
    const info = extractRateLimitHeaders(headers);
    expect(info.limit).toBeNull();
    expect(info.remaining).toBeNull();
    expect(info.resetSeconds).toBeNull();
  });

  it('deve retornar null para valores não numéricos', () => {
    const headers = {
      get: (name: string) => {
        const map: Record<string, string> = {
          'ratelimit-limit': 'abc',
          'ratelimit-remaining': 'xyz',
          'ratelimit-reset': 'not-a-number',
        };
        return map[name.toLowerCase()] ?? null;
      },
    };

    const info = extractRateLimitHeaders(headers);
    expect(info.limit).toBeNull();
    expect(info.remaining).toBeNull();
    expect(info.resetSeconds).toBeNull();
  });
});
