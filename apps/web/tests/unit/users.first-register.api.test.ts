import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAvailability: vi.fn(),
  createFirstUser: vi.fn(),
  sendVerification: vi.fn(),
  strictRateLimit: vi.fn(),
  rateLimitSubject: vi.fn(),
  logApiEvent: vi.fn(),
}));

vi.mock('@/lib/first-user-service', () => {
  class EmailInUseError extends Error {}
  class CpfCnpjInUseError extends Error {}
  class InactiveAccountEmailError extends Error {}
  class PasswordPolicyError extends Error {}

  return {
    checkFirstUserRegistrationAvailability: mocks.checkAvailability,
    createFirstUser: mocks.createFirstUser,
    EmailInUseError,
    CpfCnpjInUseError,
    InactiveAccountEmailError,
    PasswordPolicyError,
  };
});
vi.mock('@/lib/auth-email-flow', () => ({ sendEmailVerificationForUser: mocks.sendVerification }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: () => '127.0.0.1',
  rateLimitSubject: mocks.rateLimitSubject,
  strictRateLimitAsync: mocks.strictRateLimit,
}));
vi.mock('@/lib/feature-flags/external-asaas-onboarding', () => ({
  isExternalAsaasOnboardingRolloutEnabled: () => false,
}));
vi.mock('@/lib/privacy/evidence', () => ({
  requestEvidence: () => ({ ipHash: 'ip-hash', userAgentHash: 'user-agent-hash' }),
}));
vi.mock('@/lib/observability/api-logger', () => ({
  getRequestId: () => 'request-id',
  logApiOperationalEvent: mocks.logApiEvent,
}));

const validInput = {
  escolaNome: 'Escola Teste',
  nome: 'Responsável Teste',
  email: 'school@example.test',
  senha: 'Senha@123',
  legalAcceptance: {
    accepted: true,
    locale: 'pt-BR',
    source: 'REGISTER',
    documents: [
      { documentType: 'TERMS_OF_USE', documentVersion: '2026-05-27' },
      { documentType: 'PRIVACY_POLICY', documentVersion: '2026-05-27' },
      { documentType: 'DPA', documentVersion: '2026-05-27' },
    ],
  },
};

function request(body: unknown) {
  return new Request('http://localhost/api/users/first-register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/users/first-register', () => {
  beforeEach(() => {
    mocks.checkAvailability.mockResolvedValue({ available: true });
    mocks.createFirstUser.mockResolvedValue({
      id: 'user-id',
      email: 'school@example.test',
      role: 'ADMIN',
      contaId: 'conta-id',
      emailVerifiedAt: null,
    });
    mocks.sendVerification.mockResolvedValue(undefined);
    mocks.rateLimitSubject.mockResolvedValue('hashed-ip');
    mocks.strictRateLimit.mockResolvedValue({ ok: true, source: 'memory' });
  });

  afterEach(() => vi.clearAllMocks());

  it('creates a public school account, starts email verification and returns a non-cacheable result', async () => {
    const { POST } = await import('@/app/api/users/first-register/route');
    const response = await POST(request(validInput));

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      user: {
        id: 'user-id',
        email: 'school@example.test',
        role: 'ADMIN',
        contaId: 'conta-id',
        emailVerified: false,
      },
    });
    expect(mocks.checkAvailability).toHaveBeenCalledWith({ email: 'school@example.test' });
    expect(mocks.createFirstUser).toHaveBeenCalledWith(expect.objectContaining({
      ...validInput,
      registrationSource: 'PUBLIC_SELF_SERVICE',
      financeIntegrationMode: 'WHITELABEL_BAAS',
      legalAcceptanceEvidence: { ipHash: 'ip-hash', userAgentHash: 'user-agent-hash' },
    }));
    expect(mocks.sendVerification).toHaveBeenCalledWith(
      'user-id',
      { ip: '127.0.0.1', userAgent: 'vitest' },
      { callbackUrl: '/finance/wizard' },
    );
  });

  it('does not create an account when the strict rate limiter is unavailable', async () => {
    mocks.strictRateLimit.mockResolvedValueOnce({ ok: false, source: 'unavailable' });
    const { POST } = await import('@/app/api/users/first-register/route');
    const response = await POST(request(validInput));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.createFirstUser).not.toHaveBeenCalled();
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
  });

  it('rejects invalid registration payloads before checking or creating an account', async () => {
    const { POST } = await import('@/app/api/users/first-register/route');
    const response = await POST(request({ email: 'school@example.test' }));

    expect(response.status).toBe(400);
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
    expect(mocks.createFirstUser).not.toHaveBeenCalled();
  });

  it('rejects an email that already belongs to an active account', async () => {
    mocks.checkAvailability.mockResolvedValueOnce({ available: false, reason: 'LOCAL_ACTIVE' });
    const { POST } = await import('@/app/api/users/first-register/route');
    const response = await POST(request(validInput));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'EMAIL_IN_USE' });
    expect(mocks.createFirstUser).not.toHaveBeenCalled();
  });
});
