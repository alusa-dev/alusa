import { describe, expect, it } from 'vitest';

import { mapFinanceAgreementView, mapFinanceCommitResult, mapFinancePreview } from './mappers';

describe('billing agreement web mappers', () => {
  it('expõe valores e impacto de cobranças em centavos', () => {
    const preview = mapFinancePreview({
      contaId: 'conta-a',
      kind: 'UPDATE_ALLOCATION',
      agreementId: 'agreement-1',
      targetAgreementId: null,
      effectivePolicy: 'CURRENT_CYCLE_FULL',
      effectiveDate: '2026-07-21',
      sourceVersion: 4,
      previewHash: 'preview-hash-123456789',
      expiresAt: '2026-07-21T13:00:00.000Z',
      plans: [
        {
          agreementId: 'agreement-1',
          sourceVersion: 4,
          agreementValidFrom: '2026-01-01',
          agreementValidUntil: '2027-01-01',
          previousAmountCents: 30_000,
          resultingAmountCents: 35_000,
          addedAmountCents: 5_000,
          removedAmountCents: 0,
          remoteAction: 'UPDATE_SUBSCRIPTION',
          updatePendingPayments: true,
          payer: { type: 'RESPONSAVEL', id: 'payer-1', customerId: 'cus-1' },
          chargeImpacts: [
            {
              chargeId: 'charge-1',
              providerPaymentId: 'pay-1',
              status: 'PENDING',
              dueDate: '2026-08-10',
              amountCents: 30_000,
              targetAmountCents: 35_000,
              action: 'UPDATE_WITH_SUBSCRIPTION',
            },
          ],
          adjustments: [],
        },
      ],
      currentAmountCents: 30_000,
      addedAmountCents: 5_000,
      removedAmountCents: 0,
      resultingAmountCents: 35_000,
      affectedCharges: [],
      adjustments: [],
      warnings: [],
      blockers: [],
    });

    expect(preview.effectivePolicy).toBe('CURRENT_CYCLE');
    expect(preview.totals).toEqual({
      currentCents: 30_000,
      addedCents: 5_000,
      removedCents: 0,
      resultingCents: 35_000,
    });
    expect(preview.affectedPendingPayments[0]).toMatchObject({
      id: 'charge-1',
      resultingAmountCents: 35_000,
      action: 'UPDATE',
    });
  });

  it('distingue operação aplicada de reconciliação necessária', () => {
    const result = mapFinanceCommitResult(
      {
        operationId: 'operation-1',
        uiRequestId: 'request-1',
        status: 'REQUIRES_RECONCILIATION',
        agreementIds: ['agreement-1'],
        resultingAmountsCents: { 'agreement-1': 25_000 },
        versions: { 'agreement-1': 5 },
        adjustments: [],
        remoteProgress: [],
        correlationId: 'correlation-1',
      },
      new Date('2026-07-21T12:00:00.000Z'),
    );

    expect(result).toMatchObject({
      agreementId: 'agreement-1',
      status: 'REQUIRES_RECONCILIATION',
      acceptedAt: '2026-07-21T12:00:00.000Z',
    });
  });

  it('considera consistente uma assinatura pausada mesmo preservando o último valor confirmado', () => {
    const view = mapFinanceAgreementView({
      view: {
        agreement: {
          id: 'agreement-1',
          contaId: 'conta-a',
          payer: { type: 'RESPONSAVEL', id: 'payer-1', customerId: 'cus-1' },
          status: 'INACTIVE',
          billingType: 'PIX',
          cycle: 'MONTHLY',
          dueDay: 10,
          nextDueDate: '2026-08-10',
          validFrom: '2026-01-01',
          validUntil: null,
          desiredAmountCents: 0,
          confirmedAmountCents: 30_000,
          asaasSubscriptionId: 'sub-1',
          remoteStatus: 'INACTIVE',
          version: 4,
          externalReference: 'agreement-1',
          description: null,
          createdAt: '2026-01-01T12:00:00.000Z',
          updatedAt: '2026-07-21T12:00:00.000Z',
        },
        allocations: [],
        charges: [],
        currentCycle: null,
        activeAllocationTotalCents: 0,
        hasLocalDivergence: false,
      },
      payerName: 'Maria',
      studentNames: new Map(),
    });

    expect(view.reconciliationStatus).toBe('CONSISTENT');
  });
});
