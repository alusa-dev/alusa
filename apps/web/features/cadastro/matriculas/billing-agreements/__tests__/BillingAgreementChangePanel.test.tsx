import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingAgreementChangePanel } from '../BillingAgreementChangePanel';
import { useBillingAgreementChange } from '../use-billing-agreement-change';

vi.mock('../use-billing-agreement-change', () => ({
  useBillingAgreementChange: vi.fn(),
}));

const mockedUseBillingAgreementChange = vi.mocked(useBillingAgreementChange);

function lifecycle(overrides: Record<string, unknown> = {}) {
  return {
    previewState: 'success',
    commitState: 'idle',
    agreementState: 'success',
    preview: {
      agreementId: 'agreement-1',
      operation: 'UPDATE_ALLOCATION',
      effectivePolicy: 'CURRENT_CYCLE',
      sourceVersion: 3,
      previewHash: 'preview-hash-123456789',
      expiresAt: '2026-07-21T13:00:00.000Z',
      totals: {
        currentCents: 30_000,
        addedCents: 5_000,
        removedCents: 0,
        resultingCents: 35_000,
      },
      affectedPendingPayments: [
        {
          id: 'charge-1',
          dueDate: '2026-08-10',
          status: 'PENDING',
          currentAmountCents: 30_000,
          resultingAmountCents: 35_000,
          action: 'UPDATE',
        },
      ],
      paidPaymentAdjustments: [],
      warnings: [],
      blockers: [],
      canCommit: true,
    },
    commitResult: null,
    agreement: {
      id: 'agreement-1',
      status: 'ACTIVE',
      version: 3,
      payer: { type: 'RESPONSAVEL', id: 'payer-1', name: 'Maria Souza' },
      billingType: 'PIX',
      cycle: 'MONTHLY',
      dueDay: 10,
      desiredValueCents: 30_000,
      confirmedValueCents: 30_000,
      reconciliationStatus: 'CONSISTENT',
      allocations: [],
      affectedPayments: [],
      recentOperations: [],
      updatedAt: '2026-07-21T12:00:00.000Z',
    },
    error: null,
    requestPreview: vi.fn(),
    commit: vi.fn(),
    refreshAgreement: vi.fn(),
    resetPreview: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useBillingAgreementChange>;
}

const change = {
  operation: 'UPDATE_ALLOCATION' as const,
  allocations: [
    {
      allocationId: 'allocation-1',
      matriculaId: 'enrollment-1',
      kind: 'TUITION' as const,
      baseAmountCents: 35_000,
      discountAmountCents: 0,
      validFrom: '2026-07-21',
    },
  ],
};

describe('BillingAgreementChangePanel', () => {
  beforeEach(() => {
    mockedUseBillingAgreementChange.mockReturnValue(lifecycle());
  });

  it('mostra impacto monetário e cobranças pendentes antes da confirmação', () => {
    render(<React.Fragment><BillingAgreementChangePanel agreementId="agreement-1" change={change} /></React.Fragment>);

    expect(screen.getByText('Valor atual')).toBeInTheDocument();
    expect(screen.getAllByText('R$ 300,00').length).toBeGreaterThan(0);
    expect(screen.getByText('Novo total')).toBeInTheDocument();
    expect(screen.getAllByText('R$ 350,00').length).toBeGreaterThan(0);
    expect(screen.getByText('Cobranças pendentes afetadas')).toBeInTheDocument();
    expect(screen.getByText('Maria Souza')).toBeInTheDocument();
    expect(screen.getByText('Conferida')).toBeInTheDocument();
  });

  it('bloqueia confirmação quando o preview tem impeditivos', () => {
    mockedUseBillingAgreementChange.mockReturnValue(
      lifecycle({
        preview: {
          ...lifecycle().preview,
          blockers: ['A cobrança está paga e exige ajuste manual.'],
          canCommit: false,
        },
      }),
    );

    render(<React.Fragment><BillingAgreementChangePanel agreementId="agreement-1" change={change} /></React.Fragment>);

    expect(screen.getByText('Alteração bloqueada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar alteração' })).toBeDisabled();
  });

  it('solicita novo preview ao trocar a política de vigência', () => {
    const state = lifecycle();
    mockedUseBillingAgreementChange.mockReturnValue(state);
    render(<React.Fragment><BillingAgreementChangePanel agreementId="agreement-1" change={change} /></React.Fragment>);

    fireEvent.click(screen.getByRole('combobox', { name: 'Quando aplicar' }));
    fireEvent.click(screen.getByText('Próximo ciclo'));
    fireEvent.click(screen.getByRole('button', { name: 'Recalcular' }));

    expect(state.requestPreview).toHaveBeenCalledWith(
      expect.objectContaining({ effectivePolicy: 'NEXT_CYCLE' }),
    );
  });
});
