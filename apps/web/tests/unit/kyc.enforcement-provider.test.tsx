import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KycEnforcementProvider } from '@/features/kyc/KycEnforcementProvider';

void React;

const usePathnameMock = vi.fn();
const useSessionMock = vi.fn();
const useAccountVerificationMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

vi.mock('@/features/kyc/hooks/use-account-verification', () => ({
  useAccountVerification: (...args: unknown[]) => useAccountVerificationMock(...args),
}));

vi.mock('@/features/kyc/components/KycBlockingModal', () => ({
  KycBlockingModal: () => <div data-testid="kyc-blocking-modal" />,
}));

describe('KycEnforcementProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountVerificationMock.mockReturnValue({
      verification: null,
      loading: false,
      isApproved: false,
      refresh: vi.fn(),
    });
  });

  it('desabilita enforcement em rota de autenticação', () => {
    usePathnameMock.mockReturnValue('/auth/login');
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: { user: { id: 'u1', role: 'ADMIN' } },
    });

    render(
      <KycEnforcementProvider>
        <div>child</div>
      </KycEnforcementProvider>,
    );

    expect(screen.getByText('child')).toBeInTheDocument();
    expect(useAccountVerificationMock).toHaveBeenCalledWith({
      enabled: false,
      poll: false,
    });
  });

  it('desabilita enforcement na própria página de verificação para evitar duplicidade', () => {
    usePathnameMock.mockReturnValue('/conta/verificacao');
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: { user: { id: 'u1', role: 'ADMIN' } },
    });

    render(
      <KycEnforcementProvider>
        <div>child</div>
      </KycEnforcementProvider>,
    );

    expect(useAccountVerificationMock).toHaveBeenCalledWith({
      enabled: false,
      poll: false,
    });
  });

  it('mantém enforcement ativo nas páginas internas autenticadas do admin', () => {
    usePathnameMock.mockReturnValue('/dashboard');
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: { user: { id: 'u1', role: 'ADMIN' } },
    });

    render(
      <KycEnforcementProvider>
        <div>child</div>
      </KycEnforcementProvider>,
    );

    expect(useAccountVerificationMock).toHaveBeenCalledWith({
      enabled: true,
      poll: true,
    });
  });
});
