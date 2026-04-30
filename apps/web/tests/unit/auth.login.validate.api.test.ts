import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyCredentialsDetailedMock = vi.fn();
const sendAccountReactivationForEmailMock = vi.fn();

vi.mock('@/lib/auth-service', () => ({
  verifyCredentialsDetailed: verifyCredentialsDetailedMock,
}));

vi.mock('@/lib/auth-email-flow', () => ({
  sendAccountReactivationForEmail: sendAccountReactivationForEmailMock,
}));

describe('POST /api/auth/login/validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(response.status).toBe(403);
    expect(body).toEqual({ ok: false, reason: 'ACCOUNT_DEACTIVATED' });
    expect(sendAccountReactivationForEmailMock).toHaveBeenCalledWith(
      'inactive@example.com',
      expect.objectContaining({ userAgent: 'vitest' }),
    );
  });
});