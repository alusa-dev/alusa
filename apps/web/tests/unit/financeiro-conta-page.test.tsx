import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ContaPage } from '@/features/financeiro/conta/ContaPage';

void React;

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  pushToast: vi.fn(),
}));

describe('ContaPage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renderiza overview e tabela paginada de transferências', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            balance: { available: 9.01, syncedAt: '2026-03-23T20:49:00.000Z' },
            financialAccount: {
              status: 'READY',
              canTransfer: true,
              canPixCopyPaste: true,
              reasonCode: null,
            },
            features: {
              manualWithdrawEnabled: true,
              pixTransferEnabled: true,
              bankTransferEnabled: true,
            },
            fees: {
              pix: { feeValue: 2 },
              ted: { feeValue: 5 },
            },
            statementPreview: {
              summary: { receitas: 10, despesas: 0.99, estornos: 0, liquido: 9.01 },
              items: [],
            },
            recentTransfers: { items: [], total: 0 },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: 'pix:abc',
                type: 'PIX',
                label: 'Fornecedor ABC',
                detail: 'PIX • abc@teste.com',
                lastUsedAt: '2026-03-23T20:49:00.000Z',
                destination: {
                  type: 'PIX',
                  pixAddressKey: 'abc@teste.com',
                  pixAddressKeyType: 'EMAIL',
                },
              },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: 'tr_1',
                externalReference: 'transfer:tr_1',
                amount: '50.00',
                feeAmount: '2.00',
                netAmount: '50.00',
                status: 'PENDING',
                operation: 'PIX',
                recipientName: 'Fornecedor ABC Comercial',
                cpfCnpj: '***.197.862-**',
                bankName: 'Pix',
                description: 'Fornecedor ABC',
                scheduleDate: null,
                transferDate: '2026-03-23T20:50:00.000Z',
                createdAt: '2026-03-23T20:49:00.000Z',
                statusUpdatedAt: '2026-03-23T20:50:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          },
        }),
      } as Response);

    render(<ContaPage />);

    expect(await screen.findByText('Saldo disponível')).toBeInTheDocument();
    expect(await screen.findByText('Saídas e transferências')).toBeInTheDocument();
    expect(await screen.findByText('Solicitação')).toBeInTheDocument();
    expect(await screen.findByText('Taxa')).toBeInTheDocument();
    expect(screen.queryByText('Valor Líquido')).not.toBeInTheDocument();
    expect(await screen.findByText('Fornecedor Comercial')).toBeInTheDocument();
    expect(await screen.findByText('***.197.862-**')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByText('R$ 2,00')).toBeInTheDocument();
    expect(screen.getByText('R$ 50,00')).toBeInTheDocument();
  });

  it('abre o detalhe da transferência ao clicar na linha da tabela', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            balance: { available: 9.01, syncedAt: '2026-03-23T20:49:00.000Z' },
            financialAccount: {
              status: 'READY',
              canTransfer: true,
              canPixCopyPaste: true,
              reasonCode: null,
            },
            features: {
              manualWithdrawEnabled: true,
              pixTransferEnabled: true,
              bankTransferEnabled: true,
            },
            fees: null,
            statementPreview: {
              summary: { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
              items: [],
            },
            recentTransfers: { items: [], total: 0 },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { items: [] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: 'tr_1',
                externalReference: 'transfer:tr_1',
                amount: '50.00',
                feeAmount: '2.00',
                netAmount: '48.00',
                status: 'DONE',
                operation: 'PIX',
                recipientName: 'Fornecedor ABC',
                cpfCnpj: '***.197.862-**',
                bankName: 'Pix',
                description: 'Fornecedor ABC',
                scheduleDate: null,
                transferDate: '2026-03-23T20:50:00.000Z',
                createdAt: '2026-03-23T20:49:00.000Z',
                statusUpdatedAt: '2026-03-23T20:50:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          },
        }),
      } as Response);

    render(<ContaPage />);

    fireEvent.click(await screen.findByLabelText('Abrir detalhes da transferência transfer:tr_1'));

    expect(pushMock).toHaveBeenCalledWith('/financeiro/conta/transferencias/tr_1');
  });

  it('renderiza erro quando falha ao carregar dados', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' }),
    } as Response);

    render(<ContaPage />);

    expect(await screen.findByText('Não foi possível carregar a conta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('abre o wizard de transferência e reconhece automaticamente chave Pix', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            balance: { available: 9.01, syncedAt: '2026-03-23T20:49:00.000Z' },
            financialAccount: {
              status: 'READY',
              canTransfer: true,
              canPixCopyPaste: true,
              reasonCode: null,
            },
            features: {
              manualWithdrawEnabled: true,
              pixTransferEnabled: true,
              bankTransferEnabled: true,
            },
            fees: null,
            statementPreview: {
              summary: { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
              items: [],
            },
            recentTransfers: { items: [], total: 0 },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { items: [] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [],
            total: 0,
            page: 1,
            pageSize: 10,
            totalPages: 0,
          },
        }),
      } as Response);

    render(<ContaPage />);

    await screen.findByText('Saldo disponível');
    fireEvent.click(screen.getByRole('button', { name: /transferir/i }));

    expect(await screen.findByText('Etapa 1 de 5')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('wizard-next'));

    expect(await screen.findByText('Destinatário')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Chave Pix'), {
      target: { value: 'financeiro@alusa.test' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('wizard-next')).not.toBeDisabled();
    });

    expect(screen.getByText(/Chave reconhecida como/i)).toBeInTheDocument();
    expect(screen.getByText(/Confira com o destinatário/i)).toBeInTheDocument();
  });

  it('permite remover uma chave Pix salva da lista recente', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            balance: { available: 9.01, syncedAt: '2026-03-23T20:49:00.000Z' },
            financialAccount: {
              status: 'READY',
              canTransfer: true,
              canPixCopyPaste: true,
              reasonCode: null,
            },
            features: {
              manualWithdrawEnabled: true,
              pixTransferEnabled: true,
              bankTransferEnabled: true,
            },
            fees: null,
            statementPreview: {
              summary: { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
              items: [],
            },
            recentTransfers: { items: [], total: 0 },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: 'PIX:EMAIL:cliente-a00004@pix.bcb.gov.br',
                type: 'PIX',
                label: 'Jose Silva Silva',
                detail: '***.944.444-** • Banco Virtual - BACEN • cl•••@pix.bcb.gov.br',
                lastUsedAt: '2026-03-23T20:49:00.000Z',
                destination: {
                  type: 'PIX',
                  pixAddressKey: 'cliente-a00004@pix.bcb.gov.br',
                  pixAddressKeyType: 'EMAIL',
                },
              },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [],
            total: 0,
            page: 1,
            pageSize: 10,
            totalPages: 0,
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { removedCount: 1 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            balance: { available: 9.01, syncedAt: '2026-03-23T20:49:00.000Z' },
            financialAccount: {
              status: 'READY',
              canTransfer: true,
              canPixCopyPaste: true,
              reasonCode: null,
            },
            features: {
              manualWithdrawEnabled: true,
              pixTransferEnabled: true,
              bankTransferEnabled: true,
            },
            fees: null,
            statementPreview: {
              summary: { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
              items: [],
            },
            recentTransfers: { items: [], total: 0 },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { items: [] } }),
      } as Response);

    render(<ContaPage />);

    await screen.findByText('Saldo disponível');
    fireEvent.click(screen.getByRole('button', { name: /transferir/i }));
    fireEvent.click(await screen.findByTestId('wizard-next'));

    const deleteButton = await screen.findByLabelText('Excluir chave Pix Jose Silva Silva');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/finance/transfers/recipients',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('seleciona e deseleciona chave Pix salva sem preencher o input com a chave real', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            balance: { available: 9.01, syncedAt: '2026-03-23T20:49:00.000Z' },
            financialAccount: {
              status: 'READY',
              canTransfer: true,
              canPixCopyPaste: true,
              reasonCode: null,
            },
            features: {
              manualWithdrawEnabled: true,
              pixTransferEnabled: true,
              bankTransferEnabled: true,
            },
            fees: null,
            statementPreview: {
              summary: { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
              items: [],
            },
            recentTransfers: { items: [], total: 0 },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: 'PIX:EMAIL:cliente-a00004@pix.bcb.gov.br',
                type: 'PIX',
                label: 'Jose Silva Silva',
                detail: '***.944.444-** • Banco Virtual - BACEN • cl•••@pix.bcb.gov.br',
                lastUsedAt: '2026-03-23T20:49:00.000Z',
                destination: {
                  type: 'PIX',
                  pixAddressKey: 'cliente-a00004@pix.bcb.gov.br',
                  pixAddressKeyType: 'EMAIL',
                  recipientDocumentMasked: '***.944.444-**',
                  recipientBank: 'Banco Virtual - BACEN',
                },
              },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [],
            total: 0,
            page: 1,
            pageSize: 10,
            totalPages: 0,
          },
        }),
      } as Response);

    render(<ContaPage />);

    await screen.findByText('Saldo disponível');
    fireEvent.click(screen.getByRole('button', { name: /transferir/i }));
    fireEvent.click(await screen.findByTestId('wizard-next'));

    const pixInput = screen.getByLabelText('Chave Pix') as HTMLInputElement;
    const savedRecipientLabel = await screen.findByText(/Jose Silva Silva \*\*\*\.944\.444-\*\*/i);
    const savedRecipient = savedRecipientLabel.closest('button');

    expect(savedRecipient).not.toBeNull();

    fireEvent.click(savedRecipient as HTMLButtonElement);

    expect(pixInput.value).toBe('');
    expect(screen.getByText(/Chave salva selecionada/i)).toBeInTheDocument();
    expect(screen.getByTestId('wizard-next')).not.toBeDisabled();

    fireEvent.click(savedRecipient as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.queryByText(/Chave salva selecionada/i)).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('wizard-next')).toBeDisabled();
  });
});
