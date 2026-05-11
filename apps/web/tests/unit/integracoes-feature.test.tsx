import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useSessionMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt} {...props} />,
}));

describe('IntegracoesFeature', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('direciona para a gestão do Asaas quando a conta está no modo externo', async () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
        },
      },
    });

    const { IntegracoesFeature } = await import('@/features/integracoes/IntegracoesFeature');

    render(<IntegracoesFeature />);

    const card = screen.getByRole('button', { name: /Plataforma de pagamento Asaas/i });
    expect(screen.getByText('Conexão pendente')).toBeInTheDocument();

    fireEvent.click(card);

    expect(pushMock).toHaveBeenCalledWith('/admin/configuracoes/integracoes/asaas');
    expect(screen.queryByText('Abra para configurar a API key.')).not.toBeInTheDocument();
  });

  it('mostra conectado quando a api key já foi vinculada mas o webhook ainda está pendente', async () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
          externalAsaasOnboardingStatus: 'WEBHOOK_PENDING',
        },
      },
    });

    const { IntegracoesFeature } = await import('@/features/integracoes/IntegracoesFeature');

    render(<IntegracoesFeature />);

    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.queryByText('Conexão pendente')).not.toBeInTheDocument();
    expect(screen.queryByText('Abra para configurar a API key.')).not.toBeInTheDocument();
  });

  it('mantém o card desabilitado quando a integração é gerenciada pela Alusa', async () => {
    useSessionMock.mockReturnValue({
      data: {
        user: {
          financeIntegrationMode: 'WHITELABEL_BAAS',
          externalAsaasOnboardingStatus: 'NOT_STARTED',
        },
      },
    });

    const { IntegracoesFeature } = await import('@/features/integracoes/IntegracoesFeature');

    render(<IntegracoesFeature />);

    const card = screen.getByRole('button', { name: /Plataforma de pagamento Asaas/i });
    expect(card).toBeDisabled();
    expect(screen.getByText('Gerenciado pela Alusa')).toBeInTheDocument();
  });
});