import { describe, it, expect } from 'vitest';

import { createSubscriptionDTOSchema } from '../create-subscription.dto';
import { listSubscriptionsQueryDTOSchema } from '../list-subscriptions-query.dto';

describe('Subscriptions DTOs', () => {
  it('valida createSubscriptionDTO', () => {
    const parsed = createSubscriptionDTOSchema.safeParse({
      contratoId: 'c1',
      matriculaId: 'm1',
      amount: '150.00',
      nextDueDate: '2026-01-10',
      billingType: 'BOLETO',
      cycle: 'MONTHLY',
      description: 'Mensalidade',
    });

    expect(parsed.success).toBe(true);
  });

  it('aceita billingType UNDEFINED para subscriptions', () => {
    const parsed = createSubscriptionDTOSchema.safeParse({
      contratoId: 'c1',
      matriculaId: 'm1',
      amount: '150.00',
      nextDueDate: '2026-01-10',
      billingType: 'UNDEFINED',
      cycle: 'MONTHLY',
    });

    expect(parsed.success).toBe(true);
  });

  it('transforma paginação no listSubscriptionsQueryDTO', () => {
    const parsed = listSubscriptionsQueryDTOSchema.safeParse({ page: '2', pageSize: '15' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.page).toBe(2);
      expect(parsed.data.pageSize).toBe(15);
    }
  });
});
