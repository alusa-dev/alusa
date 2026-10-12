import { describe, expect, it, vi } from 'vitest';

import { startEnrollmentFinancialCommandLeaseHeartbeat } from './claim-enrollment-financial-command';

describe('startEnrollmentFinancialCommandLeaseHeartbeat', () => {
  it('confirma a posse atual da assinatura e do evento no banco', async () => {
    const db = {
      billingAgreement: { count: vi.fn().mockResolvedValue(1) },
      matriculaBillingOutbox: { count: vi.fn().mockResolvedValue(1) },
    };
    const heartbeat = startEnrollmentFinancialCommandLeaseHeartbeat({
      db: db as never,
      contaId: 'conta-1',
      targetSubscriptionId: 'asaas-sub-1',
      eventId: 'event-1',
      claimToken: 'claim-1',
    });

    await expect(heartbeat.assertOwned()).resolves.toBeUndefined();
    expect(db.billingAgreement.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        contaId: 'conta-1',
        asaasSubscriptionId: 'asaas-sub-1',
        mutationLeaseToken: 'claim-1',
        mutationLeaseExpiresAt: { gt: expect.any(Date) },
      }),
    });
    expect(db.matriculaBillingOutbox.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'event-1',
        contaId: 'conta-1',
        claimToken: 'claim-1',
        leaseExpiresAt: { gt: expect.any(Date) },
      }),
    });
    await heartbeat.stop();
  });

  it('falha em modo fechado quando o evento já não pertence ao worker', async () => {
    const db = {
      billingAgreement: { count: vi.fn().mockResolvedValue(1) },
      matriculaBillingOutbox: { count: vi.fn().mockResolvedValue(0) },
    };
    const heartbeat = startEnrollmentFinancialCommandLeaseHeartbeat({
      db: db as never,
      contaId: 'conta-1',
      targetSubscriptionId: 'asaas-sub-1',
      eventId: 'event-1',
      claimToken: 'claim-1',
    });

    await expect(heartbeat.assertOwned()).rejects.toThrow('ENROLLMENT_FINANCIAL_COMMAND_LEASE_LOST');
    await heartbeat.stop();
  });
});
