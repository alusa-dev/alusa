import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const { findUniqueMock, getServerSessionMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  getServerSessionMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { invite: { findUnique: findUniqueMock } } }));
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/lib/feature-flags/external-asaas-onboarding', () => ({ isExternalAsaasOnboardingRolloutEnabled: () => false }));
vi.mock('@/components/auth/AuthPageContainer', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/app/(auth)/register/RegisterForm', () => ({ default: () => null }));
vi.mock('@/app/(auth)/register/AcceptInviteButton', () => ({ default: () => null }));
vi.mock('@/app/(auth)/register/SignOutForInviteButton', () => ({ default: () => <button>Sair e continuar com este convite</button> }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

describe('RegisterPage invite context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({ email: 'person@example.com', role: 'RECEPCAO', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) });
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1', email: 'person@example.com', authContext: 'OWNER' } });
  });

  afterEach(cleanup);

  it('explains that a collaborator invite needs the separate collaborator session', async () => {
    const { default: RegisterPage } = await import('@/app/(auth)/register/page');
    const page = await RegisterPage({ searchParams: Promise.resolve({ token: 'invite-token' }) });

    render(page);

    expect(screen.getByRole('heading', { name: 'Este convite usa outro tipo de acesso' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('entrou como responsável pela escola');
    expect(screen.getByRole('status')).toHaveTextContent('acesso como colaborador');
    expect(screen.getByRole('status')).toHaveTextContent('manter os acessos separados');
    expect(screen.getByRole('button', { name: 'Sair e continuar com este convite' })).toBeInTheDocument();
  });
});
