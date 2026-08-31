import { describe, expect, it } from 'vitest';

import {
  isMaterializedGroupedEventEntry,
  materializedPlanReferencesFromPlans,
} from './event-billing-entry';

const participant = {
  revenueEntryId: 'entry-1',
  billingGroupId: 'group-1',
  standaloneChargeId: 'plan-1',
  asaasPaymentId: null,
  asaasInstallmentId: 'installment-1',
};

const entry = {
  status: 'PENDING',
  asaasPaymentId: null,
  paymentProvider: 'ASAAS',
  actualAmount: null,
  description: 'Taxa da cobrança agrupada do evento',
};

describe('event-billing-entry', () => {
  it('identifica alocação interna coberta por plano Asaas materializado', () => {
    const references = materializedPlanReferencesFromPlans([
      { id: 'plan-1', asaasInstallmentId: 'installment-1' },
    ]);

    expect(isMaterializedGroupedEventEntry(entry, participant, references)).toBe(true);
  });

  it('preserva entrada manual ou grupo ainda sem plano materializado', () => {
    const references = materializedPlanReferencesFromPlans([]);

    expect(isMaterializedGroupedEventEntry(entry, participant, references)).toBe(false);
    expect(isMaterializedGroupedEventEntry(
      { ...entry, actualAmount: 100 },
      participant,
      new Set(['plan-1']),
    )).toBe(false);
  });
});
