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
  DialogContent: ({
    children,
    className,
    fullScreenMobile,
    disableBackdropBlur,
    overlayClass,
  }: {
    children: React.ReactNode;
    className?: string;
    fullScreenMobile?: boolean;
    disableBackdropBlur?: boolean;
    overlayClass?: string;
  }) => (
    <div
      data-testid="dialog-content"
      data-fullscreen-mobile={fullScreenMobile ? 'true' : 'false'}
      data-disable-backdrop-blur={disableBackdropBlur ? 'true' : 'false'}
      data-overlay-class={overlayClass}
      className={className}
    >
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/account/components/asaas-onboarding/ExternalAsaasOnboarding', () => ({
  ExternalAsaasOnboarding: ({ variant }: { variant?: string }) => (
    <div data-testid="external-asaas-onboarding">variant:{variant}</div>
  ),
}));

describe('ExternalAsaasOnboardingPersistentModal', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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
      '@/features/account/components/asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
    );

    render(<ExternalAsaasOnboardingPersistentModal />);

    expect(screen.getByTestId('dialog-root')).toBeInTheDocument();
    expect(screen.getByTestId('dialog-content')).toHaveAttribute('data-fullscreen-mobile', 'true');
    expect(screen.getByTestId('dialog-content')).toHaveAttribute('data-disable-backdrop-blur', 'true');
    expect(screen.getByTestId('dialog-content')).toHaveAttribute(
      'data-overlay-class',
      'alusa-registration-wizard-overlay',
    );
    expect(screen.getByTestId('dialog-content')).toHaveClass('rounded-[20px]', 'max-w-[400px]');
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
      '@/features/account/components/asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
    );

    render(<ExternalAsaasOnboardingPersistentModal />);

    expect(screen.queryByTestId('dialog-root')).not.toBeInTheDocument();
  });

  it('nao força o modal em desenvolvimento para conta BaaS', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          role: 'FINANCEIRO',
          financeIntegrationMode: 'BAAS',
          externalAsaasOnboardingStatus: 'READY',
          asaasApiKeyStatus: 'CONNECTED',
        },
      },
    });

    const { ExternalAsaasOnboardingPersistentModal } = await import(
      '@/features/account/components/asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
    );

    render(<ExternalAsaasOnboardingPersistentModal />);

    expect(screen.queryByTestId('dialog-root')).not.toBeInTheDocument();
  });

  it('nao abre o modal em desenvolvimento sem modo externo mesmo com papel ADMIN', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          role: 'USER',
          financeIntegrationMode: 'BAAS',
          externalAsaasOnboardingStatus: 'READY',
          asaasApiKeyStatus: 'CONNECTED',
        },
      },
    });

    const { ExternalAsaasOnboardingPersistentModal } = await import(
      '@/features/account/components/asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
    );

    render(<ExternalAsaasOnboardingPersistentModal />);

    expect(screen.queryByTestId('dialog-root')).not.toBeInTheDocument();
  });

  it('preserva a regra de producao quando a conta BaaS esta saudavel', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          role: 'ADMIN',
          financeIntegrationMode: 'BAAS',
          externalAsaasOnboardingStatus: 'READY',
          asaasApiKeyStatus: 'CONNECTED',
        },
      },
    });

    const { ExternalAsaasOnboardingPersistentModal } = await import(
      '@/features/account/components/asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
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
      '@/features/account/components/asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
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
        '@/features/account/components/asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
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
      '@/features/account/components/asaas-onboarding/ExternalAsaasOnboardingPersistentModal'
    );

    render(<ExternalAsaasOnboardingPersistentModal />);

    expect(screen.queryByTestId('dialog-root')).not.toBeInTheDocument();
  });
});
