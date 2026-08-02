import { describe, expect, it } from 'vitest';

import { calculateBillingAgreementChangePreview } from './calculation';
import type { BillingAgreementContext } from './types';

function context(overrides: Partial<BillingAgreementContext> = {}): BillingAgreementContext {
  return {
    agreement: {
      id: 'agreement-1',
      contaId: 'conta-1',
      payer: { type: 'RESPONSAVEL', id: 'resp-1', customerId: 'cus-1' },
      status: 'ACTIVE',
      billingType: 'PIX',
      cycle: 'MONTHLY',
      dueDay: 10,
      nextDueDate: '2026-08-10',
      validFrom: '2026-01-01',
      validUntil: null,
      desiredAmountCents: 30_000,
      confirmedAmountCents: 30_000,
      asaasSubscriptionId: 'sub-1',
      remoteStatus: 'ACTIVE',
      version: 3,
      externalReference: 'agreement:test',
      description: 'Mensalidade',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    allocations: [
      {
        id: 'allocation-1',
        contaId: 'conta-1',
        agreementId: 'agreement-1',
        enrollmentId: 'enrollment-1',
        studentId: 'student-1',
        kind: 'TUITION',
        status: 'ACTIVE',
        recurring: true,
        baseAmountCents: 20_000,
        discountAmountCents: 0,
        netAmountCents: 20_000,
        validFrom: '2026-01-01',
        validUntil: null,
        prorationPolicy: 'FULL_CURRENT_CYCLE',
      },
      {
        id: 'allocation-2',
        contaId: 'conta-1',
        agreementId: 'agreement-1',
        enrollmentId: 'enrollment-2',
        studentId: 'student-2',
        kind: 'TUITION',
        status: 'ACTIVE',
        recurring: true,
        baseAmountCents: 10_000,
        discountAmountCents: 0,
        netAmountCents: 10_000,
        validFrom: '2026-01-01',
        validUntil: null,
        prorationPolicy: 'FULL_CURRENT_CYCLE',
      },
    ],
    charges: [],
    currentCycle: { startsAt: '2026-07-01', endsAt: '2026-08-01' },
    ...overrides,
  };
}

const common = {
  contaId: 'conta-1',
  agreementId: 'agreement-1',
  actorId: 'user-1',
  reason: 'Ajuste operacional da escola',
  effectiveDate: '2026-07-21',
} as const;

describe('calculateBillingAgreementChangePreview', () => {
  it('recalcula a assinatura familiar pela soma das alocações, sem rateio igual', () => {
    const preview = calculateBillingAgreementChangePreview({
      change: {
        ...common,
        kind: 'UPDATE_ALLOCATION',
        effectivePolicy: 'CURRENT_CYCLE_FULL',
        allocations: [{
          allocationId: 'allocation-2',
          baseAmountCents: 15_000,
          discountAmountCents: 0,
          netAmountCents: 15_000,
        }],
      },
      sourceContext: context(),
      now: new Date('2026-07-21T12:00:00.000Z'),
      previewTtlMs: 60_000,
    });
    expect(preview.resultingAmountCents).toBe(35_000);
    expect(preview.plans[0]?.remoteAction).toBe('UPDATE_SUBSCRIPTION');
  });

  it('agenda cancelamento no próximo ciclo em vez de remover a assinatura imediatamente', () => {
    const preview = calculateBillingAgreementChangePreview({
      change: {
        ...common,
        kind: 'CANCEL_AGREEMENT',
        effectivePolicy: 'NEXT_CYCLE',
        effectiveDate: '2026-08-01',
      },
      sourceContext: context(),
      now: new Date('2026-07-21T12:00:00.000Z'),
      previewTtlMs: 60_000,
    });
    expect(preview.plans[0]?.remoteAction).toBe('SCHEDULE_CANCEL');
  });

  it('preserva cobrança paga e gera crédito em uma redução', () => {
    const preview = calculateBillingAgreementChangePreview({
      change: {
        ...common,
        kind: 'UPDATE_ALLOCATION',
        effectivePolicy: 'CURRENT_CYCLE_FULL',
        paidDecreaseHandling: 'CREDIT',
        allocations: [{
          allocationId: 'allocation-1',
          baseAmountCents: 15_000,
          discountAmountCents: 0,
          netAmountCents: 15_000,
        }],
      },
      sourceContext: context({
        charges: [{
          id: 'charge-1',
          contaId: 'conta-1',
          agreementId: 'agreement-1',
          allocationId: null,
          providerPaymentId: 'pay-1',
          status: 'RECEIVED',
          amountCents: 30_000,
          dueDate: '2026-07-10',
        }],
      }),
      now: new Date('2026-07-21T12:00:00.000Z'),
      previewTtlMs: 60_000,
    });
    expect(preview.adjustments).toEqual([
      expect.objectContaining({ type: 'CREDIT', amountCents: 5_000, chargeId: 'charge-1' }),
    ]);
    expect(preview.affectedCharges[0]?.action).toBe('PRESERVE');
  });

  it('pausa a assinatura ao pausar sua última alocação ativa', () => {
    const single = context({ allocations: [context().allocations[0]!] });
    single.agreement.desiredAmountCents = 20_000;
    single.agreement.confirmedAmountCents = 20_000;
    const preview = calculateBillingAgreementChangePreview({
      change: {
        ...common,
        kind: 'PAUSE_ALLOCATION',
        effectivePolicy: 'CURRENT_CYCLE_FULL',
        allocationIds: ['allocation-1'],
      },
      sourceContext: single,
      now: new Date('2026-07-21T12:00:00.000Z'),
      previewTtlMs: 60_000,
    });
    expect(preview.plans[0]?.resultingAmountCents).toBe(0);
    expect(preview.plans[0]?.remoteAction).toBe('PAUSE_SUBSCRIPTION');
  });
});
