import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEventBillingGroupCharges } from './events.service';

describe('loadEventBillingGroupCharges', () => {
  const db = {
    charge: { findMany: vi.fn() },
    standaloneInstallmentPlan: { findMany: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.charge.findMany.mockResolvedValue([]);
    db.standaloneInstallmentPlan.findMany.mockResolvedValue([]);
  });

  it('selects only fields that exist on Charge', async () => {
    await loadEventBillingGroupCharges(db as never, 'tenant-a', [{
      id: 'group-a',
      standaloneChargeId: 'charge-a',
      asaasPaymentId: 'payment-a',
      asaasInstallmentId: null,
    }]);

    const chargeArgs = db.charge.findMany.mock.calls[0]?.[0];
    expect(chargeArgs.select).toEqual({
      id: true,
      dueDate: true,
      asaasPaymentId: true,
      standaloneInstallmentPlanId: true,
      status: true,
      statusUpdatedAt: true,
      value: true,
    });

    const planArgs = db.standaloneInstallmentPlan.findMany.mock.calls[0]?.[0];
    expect(planArgs.select.charges.select).toEqual(chargeArgs.select);
  });
});
