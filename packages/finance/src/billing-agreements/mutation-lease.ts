import { prisma as defaultPrisma } from '@alusa/database';
import type { PrismaClient } from '@prisma/client';

type Database = PrismaClient;

export async function acquireBillingAgreementMutationLease(input: {
  db?: Database;
  contaId: string;
  agreementIds: string[];
  leaseToken: string;
  now: Date;
  leaseExpiresAt: Date;
}) {
  const db = input.db ?? defaultPrisma;
  const agreementIds = [...new Set(input.agreementIds)].sort();
  if (agreementIds.length === 0) return true;

  return db.$transaction(async (tx) => {
    const acquiredIds: string[] = [];
    for (const agreementId of agreementIds) {
      const result = await tx.billingAgreement.updateMany({
        where: {
          id: agreementId,
          contaId: input.contaId,
          OR: [
            { mutationLeaseToken: null },
            { mutationLeaseExpiresAt: { lte: input.now } },
          ],
        },
        data: {
          mutationLeaseToken: input.leaseToken,
          mutationLeaseExpiresAt: input.leaseExpiresAt,
        },
      });
      if (result.count !== 1) {
        if (acquiredIds.length > 0) {
          await tx.billingAgreement.updateMany({
            where: { contaId: input.contaId, id: { in: acquiredIds }, mutationLeaseToken: input.leaseToken },
            data: { mutationLeaseToken: null, mutationLeaseExpiresAt: null },
          });
        }
        return false;
      }
      acquiredIds.push(agreementId);
    }
    return true;
  });
}

export async function releaseBillingAgreementMutationLease(input: {
  db?: Database;
  contaId: string;
  agreementIds: string[];
  leaseToken: string;
}) {
  const db = input.db ?? defaultPrisma;
  const agreementIds = [...new Set(input.agreementIds)];
  if (agreementIds.length === 0) return;
  await db.billingAgreement.updateMany({
    where: { contaId: input.contaId, id: { in: agreementIds }, mutationLeaseToken: input.leaseToken },
    data: { mutationLeaseToken: null, mutationLeaseExpiresAt: null },
  });
}

export function startBillingAgreementMutationLeaseHeartbeat(input: {
  db?: Database;
  contaId: string;
  agreementIds: string[];
  leaseToken: string;
  leaseMs?: number;
  intervalMs?: number;
  clock?: () => Date;
}) {
  const db = input.db ?? defaultPrisma;
  const agreementIds = [...new Set(input.agreementIds)];
  const leaseMs = input.leaseMs ?? 10 * 60_000;
  const clock = input.clock ?? (() => new Date());
  let stopped = false;
  let lost = false;
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped || lost || agreementIds.length === 0) return;
    renewal = renewal.then(async () => {
      const now = clock();
      const result = await db.billingAgreement.updateMany({
        where: {
          contaId: input.contaId,
          id: { in: agreementIds },
          mutationLeaseToken: input.leaseToken,
          mutationLeaseExpiresAt: { gt: now },
        },
        data: { mutationLeaseExpiresAt: new Date(now.getTime() + leaseMs) },
      });
      if (result.count !== agreementIds.length) lost = true;
    }).catch(() => { lost = true; });
  }, input.intervalMs ?? Math.max(1_000, Math.floor(leaseMs / 3)));
  timer.unref?.();

  return {
    async assertOwned() {
      await renewal;
      if (lost) throw new Error('BILLING_AGREEMENT_MUTATION_LEASE_LOST');
      const activeLeaseCount = await db.billingAgreement.count({
        where: {
          contaId: input.contaId,
          id: { in: agreementIds },
          mutationLeaseToken: input.leaseToken,
          mutationLeaseExpiresAt: { gt: clock() },
        },
      });
      if (activeLeaseCount !== agreementIds.length) {
        lost = true;
        throw new Error('BILLING_AGREEMENT_MUTATION_LEASE_LOST');
      }
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await renewal;
    },
  };
}

export async function withBillingAgreementMutationLease<T>(input: {
  db?: Database;
  contaId: string;
  agreementIds: string[];
  leaseToken: string;
  now?: Date;
  leaseMs?: number;
  run: (assertOwned: () => Promise<void>) => Promise<T>;
}): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const now = input.now ?? new Date();
  const acquired = await acquireBillingAgreementMutationLease({
    db: input.db,
    contaId: input.contaId,
    agreementIds: input.agreementIds,
    leaseToken: input.leaseToken,
    now,
    leaseExpiresAt: new Date(now.getTime() + (input.leaseMs ?? 10 * 60_000)),
  });
  if (!acquired) return { acquired: false };
  const heartbeat = startBillingAgreementMutationLeaseHeartbeat({
    db: input.db,
    contaId: input.contaId,
    agreementIds: input.agreementIds,
    leaseToken: input.leaseToken,
    leaseMs: input.leaseMs,
  });
  try {
    const assertOwned = async () => {
      await heartbeat.assertOwned();
      const active = await (input.db ?? defaultPrisma).billingAgreement.count({
        where: {
          contaId: input.contaId,
          id: { in: input.agreementIds },
          mutationLeaseToken: input.leaseToken,
          mutationLeaseExpiresAt: { gt: new Date() },
        },
      });
      if (active !== new Set(input.agreementIds).size) {
        throw new Error('BILLING_AGREEMENT_MUTATION_LEASE_LOST');
      }
    };
    const result = await input.run(assertOwned);
    await heartbeat.assertOwned();
    return { acquired: true, result };
  } finally {
    await heartbeat.stop();
    await releaseBillingAgreementMutationLease({
      db: input.db,
      contaId: input.contaId,
      agreementIds: input.agreementIds,
      leaseToken: input.leaseToken,
    });
  }
}
