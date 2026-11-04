import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const { getServerSessionMock, redirectMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  redirectMock: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/components/auth/AuthPageContainer', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/app/(auth)/login/client', () => ({ default: () => <div data-testid="login-form" /> }));

describe('LoginPage invite callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue(null);
  });

  afterEach(cleanup);

  const searchParams = {
    context: 'collaborator',
    callbackUrl: '/auth/register?token=invite-token',
  };

  it('renders login when unauthenticated instead of looping back to the invite page', async () => {
    const { default: LoginPage } = await import('@/app/(auth)/login/page');
    const page = await LoginPage({ searchParams: Promise.resolve(searchParams) });

    render(page);

    expect(screen.getByTestId('login-form')).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns a matching-context session to the invite acceptance page', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1', authContext: 'COLLABORATOR' } });
    const { default: LoginPage } = await import('@/app/(auth)/login/page');

    await expect(LoginPage({ searchParams: Promise.resolve(searchParams) }))
      .rejects.toThrow('REDIRECT:/auth/register?token=invite-token');
    expect(redirectMock).toHaveBeenCalledWith('/auth/register?token=invite-token');
  });
});
