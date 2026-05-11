import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchParamsGetMock = vi.fn();
const replaceMock = vi.fn();
const signOutMock = vi.fn();
const updateMock = vi.fn();

type SessionState = {
  data: {
    user?: {
      email?: string | null;
      emailVerified?: boolean;
      role?: string | null;
      financeStatus?: string | null;
    };
  } | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
};

let sessionState: SessionState;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => ({
    get: searchParamsGetMock,
  }),
}));

vi.mock('next-auth/react', () => ({
  signOut: signOutMock,
  useSession: () => ({
    data: sessionState.data,
    status: sessionState.status,
    update: updateMock,
  }),
}));

vi.mock('@/components/auth/AuthPageContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/auth/AuthShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('ConfirmEmailPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();

    sessionState = {
      data: {
        user: {
          email: 'blend.teste@gmail.com',
          emailVerified: false,
          role: 'ADMIN',
          financeStatus: null,
          financeIntegrationMode: 'WHITELABEL_BAAS',
          externalAsaasOnboardingStatus: 'NOT_STARTED',
        },
      },
      status: 'authenticated',
    };

    searchParamsGetMock.mockReturnValue(null);
    updateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('faz refresh da sessão no máximo uma vez por montagem mesmo se o status oscilar', async () => {
    const { default: ConfirmEmailPage } = await import('@/app/(auth)/confirm-email/page');

    const { rerender } = render(<ConfirmEmailPage />);

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });

    sessionState = {
      ...sessionState,
      status: 'loading',
    };
    rerender(<ConfirmEmailPage />);

    sessionState = {
      ...sessionState,
      status: 'authenticated',
    };
    rerender(<ConfirmEmailPage />);

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
  });

  it('não tenta refresh quando o e-mail já está confirmado', async () => {
    sessionState = {
      data: {
        user: {
          email: 'blend.teste@gmail.com',
          emailVerified: true,
          role: 'ADMIN',
          financeStatus: null,
          financeIntegrationMode: 'WHITELABEL_BAAS',
          externalAsaasOnboardingStatus: 'NOT_STARTED',
        },
      },
      status: 'authenticated',
    };

    const { default: ConfirmEmailPage } = await import('@/app/(auth)/confirm-email/page');

    render(<ConfirmEmailPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/finance/wizard');
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('leva admin do modo externo para o wizard após confirmar o e-mail', async () => {
    sessionState = {
      data: {
        user: {
          email: 'blend.teste@gmail.com',
          emailVerified: true,
          role: 'ADMIN',
          financeStatus: 'FINANCE_NOT_STARTED',
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
        },
      },
      status: 'authenticated',
    };

    const { default: ConfirmEmailPage } = await import('@/app/(auth)/confirm-email/page');

    render(<ConfirmEmailPage />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/finance/wizard');
    });
  });
});