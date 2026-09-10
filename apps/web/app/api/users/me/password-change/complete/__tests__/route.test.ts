/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServerSessionMock,
  authRateLimitAsyncMock,
  completePasswordChangeMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  authRateLimitAsyncMock: vi.fn(),
  completePasswordChangeMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/rate-limit', () => ({
  authRateLimitAsync: authRateLimitAsyncMock,
  ipFromRequest: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/password-change-otp', () => ({
  PasswordChangeOtpError: class PasswordChangeOtpError extends Error {},
  completePasswordChange: completePasswordChangeMock,
}));

const { POST } = await import('../route');

function buildRequest(body: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/users/me/password-change/complete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'user-agent': 'vitest',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/users/me/password-change/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    authRateLimitAsyncMock.mockResolvedValue({ ok: true, remaining: 4, resetAt: Date.now() + 1_000 });
    completePasswordChangeMock.mockResolvedValue({ ok: true, revokedAllSessions: false });
  });

  it('mantém as outras sessões quando a opção não é marcada', async () => {
    const response = await POST(buildRequest({
      challengeId: 'challenge-1',
      verificationToken: 'verification-token-1234567890',
      newPassword: 'NovaSenha@123',
      confirmPassword: 'NovaSenha@123',
    }));

    expect(response.status).toBe(200);
    expect(completePasswordChangeMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      challengeId: 'challenge-1',
      verificationToken: 'verification-token-1234567890',
      newPassword: 'NovaSenha@123',
      revokeAllSessions: false,
      requestedByIp: '127.0.0.1',
      requestedByUserAgent: 'vitest',
    }));
  });

  it('repassa a decisão de encerrar as outras sessões', async () => {
    const response = await POST(buildRequest({
      challengeId: 'challenge-1',
      verificationToken: 'verification-token-1234567890',
      newPassword: 'NovaSenha@123',
      confirmPassword: 'NovaSenha@123',
      revokeAllSessions: true,
    }));

    expect(response.status).toBe(200);
    expect(completePasswordChangeMock).toHaveBeenCalledWith(expect.objectContaining({
      revokeAllSessions: true,
    }));
  });

  it('rejeita origem externa antes de consultar a sessão', async () => {
    const response = await POST(buildRequest({
      challengeId: 'challenge-1',
      verificationToken: 'verification-token-1234567890',
      newPassword: 'NovaSenha@123',
      confirmPassword: 'NovaSenha@123',
    }, 'https://attacker.example'));

    expect(response.status).toBe(403);
    expect(getServerSessionMock).not.toHaveBeenCalled();
  });
});
