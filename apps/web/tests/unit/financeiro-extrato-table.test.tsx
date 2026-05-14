import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExtratoTable } from '@/features/financeiro/extrato/components/ExtratoTable';
import type { LedgerEntry } from '@/features/financeiro/extrato/dtos';

describe('ExtratoTable', () => {
  it('renderiza contexto de transferencia usando destinatario, referencia e taxa correlata', () => {
    const onSelect = vi.fn();
    const entries: LedgerEntry[] = [
      {
        id: 'ft_transfer_1',
        date: '2025-06-02',
        description: 'Transferência PIX enviada',
        type: 'TRANSFERENCIA',
        status: 'CONFIRMADO',
        grossValue: -80,
        fee: 0,
        netValue: -80,
        balanceAfter: 120,
        customerName: 'Joao Silva',
        transferId: 'asaas_tr_1',
        paymentId: null,
        splitId: null,
        invoiceId: null,
        billId: null,
        paymentDunningId: null,
        creditBureauReportId: null,
        source: 'ASAAS',
        metadata: {
          asaasType: 'TRANSFER',
          rawCategory: 'TRANSFER_SENT',
          transferRequestId: 'tr_local_1',
          transferExternalReference: 'transfer:tr_local_1',
          transferRecipientBank: 'Banco Virtual - BACEN',
        },
      },
      {
        id: 'ft_transfer_fee_1',
        date: '2025-06-02',
        description: 'Taxa da transferência',
        type: 'TAXA',
        status: 'CONFIRMADO',
        grossValue: -2.5,
        fee: 2.5,
        netValue: 0,
        balanceAfter: 117.5,
        transferId: 'asaas_tr_1',
        paymentId: null,
        splitId: null,
        invoiceId: null,
        billId: null,
        paymentDunningId: null,
        creditBureauReportId: null,
        source: 'ASAAS',
        metadata: {
          asaasType: 'TRANSFER_FEE',
          rawCategory: 'TRANSFER_FEE',
        },
      },
    ];

    render(
      <ExtratoTable
        entries={entries}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('Joao Silva')).toBeInTheDocument();
    expect(screen.getByText('Banco Virtual')).toBeInTheDocument();
    expect(screen.getByText('Ted')).toBeInTheDocument();
    expect(screen.getAllByText('Confirmado').length).toBeGreaterThanOrEqual(1);
  });
});