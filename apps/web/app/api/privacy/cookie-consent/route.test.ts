import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordCookieConsent, logApiOperationalEvent } = vi.hoisted(() => ({
  recordCookieConsent: vi.fn(),
  logApiOperationalEvent: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/src/server/privacy/privacy-request.service', () => ({ recordCookieConsent }));
vi.mock('@/lib/privacy/evidence', () => ({
  requestEvidence: () => ({ ipHash: 'hashed-ip', userAgentHash: 'hashed-agent' }),
}));
vi.mock('@/lib/observability/api-logger', () => ({
  getRequestId: () => 'req-test',
  logApiOperationalEvent,
}));

import { POST } from './route';

const validPayload = {
  anonymousId: 'anonymous-123',
  categories: { essential: true, analytics: false, marketing: true, preferences: false },
  decision: 'SAVE_PREFERENCES',
  policyVersion: 'v1',
};

describe('POST /api/privacy/cookie-consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no-store success after persisting consent', async () => {
    const response = await POST(
      new Request('http://localhost/api/privacy/cookie-consent', {
        method: 'POST',
        body: JSON.stringify(validPayload),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(recordCookieConsent).toHaveBeenCalledWith(
      expect.objectContaining({ anonymousId: 'anonymous-123', ipHash: 'hashed-ip' }),
    );
    expect(logApiOperationalEvent).not.toHaveBeenCalled();
  });

  it('returns a controlled retryable response and logs no consent data on persistence failure', async () => {
    recordCookieConsent.mockRejectedValueOnce(
      new TypeError('database unavailable; anonymousId=secret'),
    );
    const response = await POST(
      new Request('http://localhost/api/privacy/cookie-consent', {
        method: 'POST',
        body: JSON.stringify(validPayload),
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Não foi possível salvar as preferências.' });
    expect(logApiOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'api.privacy.cookie_consent.persist.failed',
        requestId: 'req-test',
        result: 'persistence_failed',
        error: expect.any(TypeError),
      }),
    );
    expect(JSON.stringify(logApiOperationalEvent.mock.calls)).not.toContain('anonymous-123');
    expect(JSON.stringify(logApiOperationalEvent.mock.calls)).not.toContain('secret');
  });

  it('rejects malformed consent without persistence', async () => {
    const response = await POST(
      new Request('http://localhost/api/privacy/cookie-consent', { method: 'POST', body: '{' }),
    );
    expect(response.status).toBe(400);
    expect(recordCookieConsent).not.toHaveBeenCalled();
  });
});
