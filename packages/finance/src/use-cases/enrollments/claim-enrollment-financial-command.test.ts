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

  it('renova a lease com o relógio corrente em vez de congelar o prazo inicial', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-10-12T12:00:00.000Z');
    vi.setSystemTime(startedAt);
    const tx = {
      billingAgreement: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      matriculaBillingOutbox: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const db = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      billingAgreement: { count: vi.fn().mockResolvedValue(1) },
      matriculaBillingOutbox: { count: vi.fn().mockResolvedValue(1) },
    };
    const heartbeat = startEnrollmentFinancialCommandLeaseHeartbeat({
      db: db as never,
      contaId: 'conta-1',
      targetSubscriptionId: 'asaas-sub-1',
      eventId: 'event-1',
      claimToken: 'claim-1',
      leaseMs: 3_000,
      intervalMs: 1_000,
    });

    try {
      await vi.advanceTimersByTimeAsync(1_500);
      await heartbeat.assertOwned();

      expect(tx.billingAgreement.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { mutationLeaseExpiresAt: new Date(startedAt.getTime() + 4_000) },
      }));
      expect(db.matriculaBillingOutbox.count).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ leaseExpiresAt: { gt: new Date(startedAt.getTime() + 1_500) } }),
      }));
    } finally {
      await heartbeat.stop();
      vi.useRealTimers();
    }
  });
});
