import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/first-user-service', () => ({
  checkFirstUserRegistrationAvailability: vi.fn(),
  createFirstUser: vi.fn(),
}));
vi.mock('@/lib/auth-email-flow', () => ({ sendEmailVerificationForUser: vi.fn() }));

describe('POST /api/users/first-register', () => {
  it('returns a stable 403 and does not create unaffiliated public accounts', async () => {
    const { POST } = await import('@/app/api/users/first-register/route');
    const response = await POST();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'O cadastro público está temporariamente indisponível. Entre na lista de espera ou aceite um convite da sua escola.',
      code: 'PUBLIC_SIGNUP_CLOSED',
    });
    const { createFirstUser, checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');
    const { sendEmailVerificationForUser } = await import('@/lib/auth-email-flow');
    expect(createFirstUser).not.toHaveBeenCalled();
    expect(checkFirstUserRegistrationAvailability).not.toHaveBeenCalled();
    expect(sendEmailVerificationForUser).not.toHaveBeenCalled();
  });
});
