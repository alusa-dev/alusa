import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';
import { claimPaymentCommandForDispatch, claimPaymentRefundCommandForDispatch } from './payment-command-ledger';

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
      // Eligibility coverage/history is immutable; leave the synthetic tenant
      // inactive in the disposable test database.
      await prisma.conta.update({ where: { id: conta.id }, data: { status: 'INATIVO' } });
    }
  }, 30_000);

  it('allows one active refund command when two idempotency keys race for the same payment', async () => {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Refund keys race ${suffix}` } });
    const paymentId = `payment-${suffix}`;
    const correlations = [`refund-a-${suffix}`, `refund-b-${suffix}`];
    const jobs: Array<{ id: string; correlationId: string }> = [];
    try {
      for (const correlationId of correlations) {
        const job = await prisma.asaasIntegrationJob.create({
          data: {
            contaId: conta.id,
            type: 'PAYMENT_REFUND_COMMAND',
            idempotencyKey: correlationId,
            payload: {
              commandStatus: 'REQUESTED',
              commandType: 'PAYMENT_REFUND_COMMAND',
              entityType: 'CHARGE',
              entityId: `charge-${suffix}`,
              asaasPaymentId: paymentId,
              expectedEvents: ['PAYMENT_REFUNDED'],
              correlationId,
              requestedAt: new Date().toISOString(),
            },
          },
        });
        jobs.push({ id: job.id, correlationId });
      }

      const claims = await Promise.all(jobs.map((job) => claimPaymentRefundCommandForDispatch({
        contaId: conta.id,
        jobId: job.id,
        asaasPaymentId: paymentId,
        providerStatus: 'RECEIVED',
      })));

      expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
      const winnerIndex = claims.findIndex((claim) => claim.claimed);
      const loserIndex = winnerIndex === 0 ? 1 : 0;
      expect(claims[loserIndex]?.activeCommand).toMatchObject({
        id: jobs[winnerIndex]?.id,
        correlationId: jobs[winnerIndex]?.correlationId,
      });

      const persistedJobs = await prisma.asaasIntegrationJob.findMany({
        where: {
          contaId: conta.id,
          type: 'PAYMENT_REFUND_COMMAND',
          AND: [{ payload: { path: ['asaasPaymentId'], equals: paymentId } }],
        },
        select: { id: true, status: true, payload: true },
      });
      const activeJobs = persistedJobs.filter((job) => {
        const payload = job.payload as { commandStatus?: string };
        return ['REQUESTED', 'SENT_TO_ASAAS', 'NEEDS_RECONCILIATION'].includes(payload.commandStatus ?? '');
      });
      expect(activeJobs).toHaveLength(1);
      expect(activeJobs[0]).toMatchObject({ id: jobs[winnerIndex]?.id, status: 'PROCESSING' });
      const loser = persistedJobs.find((job) => job.id === jobs[loserIndex]?.id);
      expect(loser?.payload).toMatchObject({
        commandStatus: 'FAILED',
        correlationId: jobs[loserIndex]?.correlationId,
      });
    } finally {
      if (jobs.length > 0) {
        await prisma.asaasIntegrationJob.deleteMany({ where: { contaId: conta.id, id: { in: jobs.map((job) => job.id) } } });
      }
      // Eligibility coverage/history is immutable; leave the synthetic tenant
      // inactive in the disposable test database.
      await prisma.conta.update({ where: { id: conta.id }, data: { status: 'INATIVO' } });
    }
  }, 30_000);
});
