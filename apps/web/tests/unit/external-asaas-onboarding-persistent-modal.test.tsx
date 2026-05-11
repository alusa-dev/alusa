import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useSessionMock = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/external-asaas-onboarding/ExternalAsaasOnboarding', () => ({
  ExternalAsaasOnboarding: ({ variant }: { variant?: string }) => (
    <div data-testid="external-asaas-onboarding">variant:{variant}</div>
  ),
}));

describe('ExternalAsaasOnboardingPersistentModal', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('abre o modal para conta externa com onboarding principal concluido e api key pendente', async () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          role: 'ADMIN',
          financeStatus: 'FINANCE_APPROVED',
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
        },
      },
    });

    const { ExternalAsaasOnboardingPersistentModal } = await import(
      '@/components/external-asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
    );

    render(<ExternalAsaasOnboardingPersistentModal />);

    expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
    expect(screen.getByTestId('external-asaas-onboarding')).toHaveTextContent('variant:modal');
  });

  it('nao abre o modal quando a conta externa ja esta pronta', async () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          role: 'ADMIN',
          financeStatus: 'FINANCE_APPROVED',
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          externalAsaasOnboardingStatus: 'READY',
        },
      },
    });

    const { ExternalAsaasOnboardingPersistentModal } = await import(
      '@/components/external-asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
    );

    render(<ExternalAsaasOnboardingPersistentModal />);

    expect(screen.queryByTestId('dialog-root')).not.toBeInTheDocument();
  });
});
