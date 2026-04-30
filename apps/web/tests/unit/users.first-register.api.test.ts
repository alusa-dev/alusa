import { beforeEach, describe, expect, it, vi } from 'vitest';

const createFirstUserMock = vi.fn();
const checkFirstUserRegistrationAvailabilityMock = vi.fn();
const sendEmailVerificationForUserMock = vi.fn();

vi.mock('@/lib/first-user-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/first-user-service')>('@/lib/first-user-service');
  return {
    ...actual,
    checkFirstUserRegistrationAvailability: checkFirstUserRegistrationAvailabilityMock,
    createFirstUser: createFirstUserMock,
  };
});

vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true, remaining: 9, resetAt: Date.now() + 1000 })),
}));

vi.mock('@/lib/auth-email-flow', () => ({
  sendEmailVerificationForUser: sendEmailVerificationForUserMock,
}));

describe('POST /api/users/first-register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkFirstUserRegistrationAvailabilityMock.mockResolvedValue({ available: true });
  });

  it('bloqueia cadastro quando existe conta desativada e orienta login para reativação', async () => {
    checkFirstUserRegistrationAvailabilityMock.mockResolvedValueOnce({
      available: false,
      reason: 'LOCAL_DEACTIVATED',
      userId: 'user_1',
      email: 'inactive@example.com',
    });

    const { POST } = await import('@/app/api/users/first-register/route');
    const req = new Request('http://localhost/api/users/first-register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'vitest',
      },
      body: JSON.stringify({
        nome: 'Conta Inativa',
        firstName: 'Conta',
        lastName: 'Inativa',
        email: 'inactive@example.com',
        senha: 'SenhaFort3!',
        escolaNome: 'Conta Inativa',
      }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('ACCOUNT_DEACTIVATED');
    expect(body.error).toContain('Faça login para iniciar a reativação');
    expect(createFirstUserMock).not.toHaveBeenCalled();
    expect(sendEmailVerificationForUserMock).not.toHaveBeenCalled();
  });

  it('bloqueia cadastro quando o e-mail já existe no Asaas', async () => {
    checkFirstUserRegistrationAvailabilityMock.mockResolvedValueOnce({
      available: false,
      reason: 'ASAAS_EMAIL_IN_USE',
    });

    const { POST } = await import('@/app/api/users/first-register/route');
    const req = new Request('http://localhost/api/users/first-register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'vitest',
      },
      body: JSON.stringify({
        nome: 'Conta Financeira',
        firstName: 'Conta',
        lastName: 'Financeira',
        email: 'finance@example.com',
        senha: 'SenhaFort3!',
        escolaNome: 'Conta Financeira',
      }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('ASAAS_EMAIL_IN_USE');
    expect(createFirstUserMock).not.toHaveBeenCalled();
    expect(sendEmailVerificationForUserMock).not.toHaveBeenCalled();
  });
});