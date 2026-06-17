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

  it('abre o modal na primeira configuracao da api key', async () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          role: 'ADMIN',
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
          asaasApiKeyStatus: 'MISSING',
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

  it('nao abre o modal quando a chave esta saudavel e conectada', async () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          role: 'ADMIN',
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          externalAsaasOnboardingStatus: 'READY',
          asaasApiKeyStatus: 'CONNECTED',
        },
      },
    });

    const { ExternalAsaasOnboardingPersistentModal } = await import(
      '@/components/external-asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
    );

    render(<ExternalAsaasOnboardingPersistentModal />);

    expect(screen.queryByTestId('dialog-root')).not.toBeInTheDocument();
  });

  it('nao abre o modal quando webhook ainda esta pendente mas a chave continua conectada', async () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          role: 'ADMIN',
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          externalAsaasOnboardingStatus: 'WEBHOOK_PENDING',
          asaasApiKeyStatus: 'CONNECTED',
        },
      },
    });

    const { ExternalAsaasOnboardingPersistentModal } = await import(
      '@/components/external-asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
    );

    render(<ExternalAsaasOnboardingPersistentModal />);

    expect(screen.queryByTestId('dialog-root')).not.toBeInTheDocument();
  });

  it('reabre o modal quando a chave foi expirada, desabilitada ou excluida no Asaas', async () => {
    for (const asaasApiKeyStatus of ['EXPIRED', 'DISABLED', 'DELETED', 'REVOKED'] as const) {
      cleanup();
      useSessionMock.mockReturnValue({
        status: 'authenticated',
        data: {
          user: {
            role: 'ADMIN',
            financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
            externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
            asaasApiKeyStatus,
          },
        },
      });

      const { ExternalAsaasOnboardingPersistentModal } = await import(
        '@/components/external-asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
      );

      render(<ExternalAsaasOnboardingPersistentModal />);

      expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
    }
  });

  it('nao abre o modal para papeis sem permissao financeira', async () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          role: 'USER',
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
          asaasApiKeyStatus: 'MISSING',
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
