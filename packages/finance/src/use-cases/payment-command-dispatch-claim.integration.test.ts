import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';
import { claimPaymentCommandForDispatch } from './payment-command-ledger';

describe('payment command dispatch claim (PostgreSQL)', () => {
  it('allows one of two concurrent callers to claim the same non-idempotent refund POST', async () => {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Refund claim ${suffix}` } });
    let jobId: string | undefined;
    try {
      const job = await prisma.asaasIntegrationJob.create({
        data: {
          contaId: conta.id,
          type: 'PAYMENT_REFUND_COMMAND',
          idempotencyKey: suffix,
          payload: {
            commandStatus: 'REQUESTED',
            commandType: 'PAYMENT_REFUND_COMMAND',
            entityType: 'CHARGE',
            entityId: `charge-${suffix}`,
            asaasPaymentId: `payment-${suffix}`,
            expectedEvents: ['PAYMENT_REFUNDED'],
            correlationId: suffix,
            requestedAt: new Date().toISOString(),
          },
        },
      });
      jobId = job.id;

      const claims = await Promise.all([
        claimPaymentCommandForDispatch({ contaId: conta.id, jobId: job.id }),
        claimPaymentCommandForDispatch({ contaId: conta.id, jobId: job.id }),
      ]);

      expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
      const persisted = await prisma.asaasIntegrationJob.findFirst({
        where: { id: job.id, contaId: conta.id },
        select: { payload: true },
      });
      expect(persisted?.payload).toMatchObject({ commandStatus: 'SENT_TO_ASAAS' });
    } finally {
      if (jobId) await prisma.asaasIntegrationJob.deleteMany({ where: { id: jobId, contaId: conta.id } });
      await prisma.conta.deleteMany({ where: { id: conta.id } });
    }
  }, 30_000);
});
