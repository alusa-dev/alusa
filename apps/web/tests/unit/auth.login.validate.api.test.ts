import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyCredentialsDetailedMock = vi.fn();
const sendAccountReactivationForEmailMock = vi.fn();
const authRateLimitAsyncMock = vi.fn();

vi.mock('@/lib/auth-service', () => ({
  verifyCredentialsDetailed: verifyCredentialsDetailedMock,
}));

vi.mock('@/lib/auth-email-flow', () => ({
  sendAccountReactivationForEmail: sendAccountReactivationForEmailMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  authRateLimitAsync: authRateLimitAsyncMock,
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimitSubject: vi.fn(async () => 'email-hash'),
}));

describe('POST /api/auth/login/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRateLimitAsyncMock.mockResolvedValue({ ok: true, remaining: 4, resetAt: Date.now() + 1_000 });
  });

  it('envia e-mail de reativação quando a conta está desativada', async () => {
    verifyCredentialsDetailedMock.mockResolvedValueOnce({
      ok: false,
      reason: 'ACCOUNT_DEACTIVATED',
    });

    const { POST } = await import('@/app/api/auth/login/validate/route');
    const req = new Request('http://localhost/api/auth/login/validate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'vitest',
      },
      body: JSON.stringify({ email: 'inactive@example.com', password: 'SenhaFort3!' }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
    expect(sendAccountReactivationForEmailMock).toHaveBeenCalledWith(
      'inactive@example.com',
      expect.objectContaining({ userAgent: 'vitest' }),
    );
  });

  it.each(['USER_NOT_FOUND', 'USER_INACTIVE', 'INVALID_PASSWORD', 'ACCOUNT_UNAVAILABLE'])(
    'não revela o motivo interno %s',
    async (reason) => {
      verifyCredentialsDetailedMock.mockResolvedValueOnce({ ok: false, reason });

      const { POST } = await import('@/app/api/auth/login/validate/route');
      const response = await POST(new Request('http://localhost/api/auth/login/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'SenhaFort3!' }),
      }));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
    },
  );

  it('bloqueia antes de verificar a senha quando o limite é excedido', async () => {
    authRateLimitAsyncMock.mockResolvedValueOnce({ ok: false, remaining: 0, resetAt: Date.now() + 1_000 });

    const { POST } = await import('@/app/api/auth/login/validate/route');
    const response = await POST(new Request('http://localhost/api/auth/login/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'SenhaFort3!' }),
    }));

    expect(response.status).toBe(429);
    expect(verifyCredentialsDetailedMock).not.toHaveBeenCalled();
  });
});
