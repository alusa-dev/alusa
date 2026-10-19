import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { redirectMock, inviteFindUniqueMock, userFindFirstMock, getServerSessionMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
  inviteFindUniqueMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  getServerSessionMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/prisma', () => ({
  default: { invite: { findUnique: inviteFindUniqueMock }, usuario: { findFirst: userFindFirstMock } },
}));
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/lib/feature-flags/external-asaas-onboarding', () => ({
  isExternalAsaasOnboardingRolloutEnabled: vi.fn(() => false),
}));
vi.mock('@/components/auth/AuthPageContainer', () => ({ default: 'AuthPageContainer' }));
vi.mock('@/app/(auth)/register/RegisterForm', () => ({ default: 'RegisterForm' }));
vi.mock('@/app/(auth)/register/AcceptInviteButton', () => ({ default: 'AcceptInviteButton' }));
vi.mock('@/app/(auth)/register/SignOutForInviteButton', () => ({ default: 'SignOutForInviteButton' }));

import RegisterPage from '@/app/(auth)/register/page';

describe('public register page during assisted pilot', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('redirects unaffiliated public signup to the waitlist', async () => {
    await expect(RegisterPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/lista-de-espera');
    expect(redirectMock).toHaveBeenCalledWith('/lista-de-espera');
    expect(inviteFindUniqueMock).not.toHaveBeenCalled();
    expect(getServerSessionMock).not.toHaveBeenCalled();
  });

  it('continues validating invitation tokens on the registration page', async () => {
    vi.stubGlobal('React', React);
    inviteFindUniqueMock.mockResolvedValueOnce({
      email: 'invitee@example.com', role: 'RECEPCAO', status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
    });
    getServerSessionMock.mockResolvedValueOnce(null);
    userFindFirstMock.mockResolvedValueOnce(null);

    await expect(RegisterPage({ searchParams: Promise.resolve({ token: 'valid-invite-token' }) })).resolves.toBeTruthy();
    expect(inviteFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { token: 'valid-invite-token' } }));
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
