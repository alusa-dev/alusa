import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ContaTransferDetailPage } from '@/features/financeiro/conta/ContaTransferDetailPage';

void React;

const { pushToastMock } = vi.hoisted(() => ({
  pushToastMock: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  pushToast: pushToastMock,
}));

describe('ContaTransferDetailPage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('mostra cancelamento quando a transferência está pendente e atualiza o estado oficial após cancelar', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'tr_1',
            status: 'PENDING',
            operation: 'TED',
            amount: '80.00',
            feeAmount: '0.00',
            netAmount: '80.00',
            createdAt: '2026-03-25T22:29:07.522Z',
            transferDate: '2026-03-25',
            scheduleDate: '2026-03-26',
            description: null,
            failReason: null,
            transactionReceiptUrl: null,
            endToEndIdentifier: null,
            recipient: {
              name: 'João Silva',
              cpfCnpj: '***.911.111-**',
              bankName: 'Banco do Brasil',
              pixKey: null,
              agency: '0001',
              account: '12345',
              accountDigit: '6',
              accountType: 'CONTA_CORRENTE',
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            status: 'CANCELED',
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 'tr_1',
            status: 'CANCELED',
            operation: 'TED',
            amount: '80.00',
            feeAmount: '0.00',
            netAmount: '80.00',
            createdAt: '2026-03-25T22:29:07.522Z',
            transferDate: '2026-03-25',
            scheduleDate: '2026-03-26',
            description: null,
            failReason: null,
            transactionReceiptUrl: null,
            endToEndIdentifier: null,
            recipient: {
              name: 'João Silva',
              cpfCnpj: '***.911.111-**',
              bankName: 'Banco do Brasil',
              pixKey: null,
              agency: '0001',
              account: '12345',
              accountDigit: '6',
              accountType: 'CONTA_CORRENTE',
            },
          },
        }),
      } as Response);

    render(<ContaTransferDetailPage transferId="tr_1" />);

    expect(await screen.findByRole('button', { name: 'Cancelar transferência' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar transferência' }));

    expect(await screen.findByText('Cancelar transferência?')).toBeInTheDocument();

    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar transferência' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        '/api/finance/transfers/tr_1/cancel',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    expect(pushToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Transferência cancelada',
        variant: 'success',
      }),
    );

    expect(await screen.findByText('Cancelada')).toBeInTheDocument();
  });

  it('mantém o botão de comprovante quando a transferência já está concluída', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 'tr_2',
          status: 'DONE',
          operation: 'PIX',
          amount: '80.00',
          feeAmount: '0.00',
          netAmount: '80.00',
          createdAt: '2026-03-25T22:29:07.522Z',
          transferDate: '2026-03-25',
          scheduleDate: null,
          description: null,
          failReason: null,
          transactionReceiptUrl: 'https://example.com/comprovante.pdf',
          endToEndIdentifier: null,
          recipient: {
            name: 'João Silva',
            cpfCnpj: '***.911.111-**',
            bankName: 'Banco do Brasil',
            pixKey: 'cliente-a00001@pix.bcb.gov.br',
            agency: null,
            account: null,
            accountDigit: null,
            accountType: null,
          },
        },
      }),
    } as Response);

    render(<ContaTransferDetailPage transferId="tr_2" />);

    expect(await screen.findByRole('link', { name: 'Ver comprovante' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar transferência' })).not.toBeInTheDocument();
  });
});