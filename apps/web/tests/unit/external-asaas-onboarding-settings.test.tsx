import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateMock = vi.fn();
const useSessionMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

describe('ExternalAsaasOnboarding settings', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSessionMock.mockReturnValue({ update: updateMock });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mostra apenas o input mascarado e exibe substituir apenas quando há nova api digitada', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          schoolName: 'Escola Externa',
          cpfCnpj: null,
          phone: null,
          status: 'READY',
          asaasAccountId: 'acc_1',
          asaasEmail: 'financeiro@escola.com',
          hasApiKey: true,
        },
      }),
    });

    const { ExternalAsaasOnboarding } = await import('@/components/external-asaas-onboarding/ExternalAsaasOnboarding');

    render(<ExternalAsaasOnboarding variant="settings" />);

    const input = await screen.findByPlaceholderText('$aact_hmlg_••••••••••••••••');

    expect(screen.getByText('Como obter a API key no Asaas')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'asaas.com' })).toHaveAttribute('href', 'https://www.asaas.com');
    expect(
      screen.getByText('Acesse o site do Asaas em', { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No painel do Asaas, abra Minha conta e acesse a área de API da conta.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Copie a API key exibida no Asaas e cole no campo abaixo para testar ou substituir a credencial.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Conta Asaas')).not.toBeInTheDocument();
    expect(screen.queryByText('E-mail da conta')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Testar conexão' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Substituir' })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '$aact_hmlg_nova_chave_valida' } });

    expect(screen.getByRole('button', { name: 'Testar conexão' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Substituir' })).toBeInTheDocument();
  });

  it('testa a conexão sem persistir a api key', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            schoolName: 'Escola Externa',
            cpfCnpj: null,
            phone: null,
            status: 'READY',
            asaasAccountId: 'acc_1',
            asaasEmail: 'financeiro@escola.com',
            hasApiKey: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, summary: 'Conexão validada com sucesso.' }),
      });

    const { ExternalAsaasOnboarding } = await import('@/components/external-asaas-onboarding/ExternalAsaasOnboarding');

    render(<ExternalAsaasOnboarding variant="settings" />);

    const input = await screen.findByPlaceholderText('$aact_hmlg_••••••••••••••••');
    fireEvent.change(input, { target: { value: '$aact_hmlg_nova_chave_valida' } });
    fireEvent.click(screen.getByRole('button', { name: 'Testar conexão' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/admin/asaas/test-key',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(toastSuccessMock).toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});