import { MatriculaBillingOutboxStatus, Prisma, type PrismaClient } from '@prisma/client';

const SERIALIZED_SUBSCRIPTION_MUTATION_TYPES = [
  'APPLY_ENROLLMENT_FINANCIAL_COMMAND',
  'UPDATE_EXISTING_SUBSCRIPTION_BILLING',
] as const;

/** Claims the oldest active subscription mutation and records its cross-outbox lease. */
export async function claimEnrollmentFinancialCommand(input: {
  db: PrismaClient;
  event: { id: string; contaId: string; status: MatriculaBillingOutboxStatus };
  target: { kind: 'ASAAS_SUBSCRIPTION'; id: string } | { kind: 'SUBSCRIPTION'; id: string };
  now: Date;
  claimToken: string;
  leaseExpiresAt: Date;
}) {
  return input.db.$transaction(async (tx) => {
    let agreementLock: Array<{ id: string; asaasSubscriptionId: string | null }>;
    if (input.target.kind === 'ASAAS_SUBSCRIPTION') {
      agreementLock = await tx.$queryRaw<Array<{ id: string; asaasSubscriptionId: string | null }>>(Prisma.sql`
        SELECT "id", "asaasSubscriptionId" FROM "BillingAgreement"
        WHERE "contaId" = ${input.event.contaId} AND "asaasSubscriptionId" = ${input.target.id}
        FOR UPDATE
      `);
    } else {
      const subscriptionRows = await tx.$queryRaw<Array<{ billingAgreementId: string | null }>>(Prisma.sql`
        SELECT "billingAgreementId" FROM "Subscription"
        WHERE "contaId" = ${input.event.contaId} AND "id" = ${input.target.id}
        FOR UPDATE
      `);
      const billingAgreementId = subscriptionRows[0]?.billingAgreementId;
      agreementLock = billingAgreementId
        ? await tx.$queryRaw<Array<{ id: string; asaasSubscriptionId: string | null }>>(Prisma.sql`
            SELECT "id", "asaasSubscriptionId" FROM "BillingAgreement"
            WHERE "contaId" = ${input.event.contaId} AND "id" = ${billingAgreementId}
            FOR UPDATE
          `)
        : [];
    }
    if (agreementLock.length === 0) {
      await tx.matriculaBillingOutbox.updateMany({
        where: { id: input.event.id, contaId: input.event.contaId, status: input.event.status },
        data: {
          status: MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
          lastError: 'ASSINATURA_CANONICA_AUSENTE_AO_SERIALIZAR_COMANDO',
        },
      });
      return { count: 0 };
    }

    const agreement = agreementLock[0]!;
    if (!agreement.asaasSubscriptionId) {
      await tx.matriculaBillingOutbox.updateMany({
        where: { id: input.event.id, contaId: input.event.contaId, status: input.event.status },
        data: {
          status: MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
          lastError: 'ASSINATURA_REMOTA_CANONICA_AUSENTE_AO_SERIALIZAR_COMANDO',
        },
      });
      return { count: 0 };
    }

    const legacySubscriptions = await tx.subscription.findMany({
      where: { contaId: input.event.contaId, billingAgreementId: agreement.id },
      select: { id: true },
    });
    const subscriptionReferences = [...new Set([agreement.asaasSubscriptionId, ...legacySubscriptions.map(({ id }) => id)])];

    const queue = await tx.matriculaBillingOutbox.findMany({
      where: {
        contaId: input.event.contaId,
        eventType: { in: [...SERIALIZED_SUBSCRIPTION_MUTATION_TYPES] },
        OR: [
          ...subscriptionReferences.flatMap((reference) => [
            { payload: { path: ['targetSubscriptionId'], equals: reference } },
            { payload: { path: ['subscriptionTargetId'], equals: reference } },
          ]),
        ],
        status: {
          in: [
            MatriculaBillingOutboxStatus.PENDING,
            MatriculaBillingOutboxStatus.PROCESSING,
            MatriculaBillingOutboxStatus.FAILED,
            MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
          ],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (queue[0]?.id !== input.event.id) return { count: 0 };

    const lease = await tx.billingAgreement.updateMany({
      where: {
        id: agreement.id,
        contaId: input.event.contaId,
        OR: [
          { mutationLeaseToken: null },
          { mutationLeaseExpiresAt: { lte: input.now } },
        ],
      },
      data: {
        mutationLeaseToken: input.claimToken,
        mutationLeaseExpiresAt: input.leaseExpiresAt,
      },
    });
    if (lease.count !== 1) return { count: 0 };

    const claimed = await tx.matriculaBillingOutbox.updateMany({
      where: {
        id: input.event.id,
        contaId: input.event.contaId,
        availableAt: { lte: input.now },
        terminalIntent: null,
        OR: [
          { status: { in: [MatriculaBillingOutboxStatus.PENDING, MatriculaBillingOutboxStatus.FAILED] } },
          { status: MatriculaBillingOutboxStatus.PROCESSING, leaseExpiresAt: { lte: input.now } },
        ],
      },
      data: {
        status: MatriculaBillingOutboxStatus.PROCESSING,
        claimToken: input.claimToken,
        lockedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
        lastAttemptAt: input.now,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (claimed.count !== 1) {
      await tx.billingAgreement.updateMany({
        where: { id: agreement.id, contaId: input.event.contaId, mutationLeaseToken: input.claimToken },
        data: { mutationLeaseToken: null, mutationLeaseExpiresAt: null },
      });
    }
    return claimed.count === 1 ? { ...claimed, asaasSubscriptionId: agreement.asaasSubscriptionId } : claimed;
  });
}

export async function releaseEnrollmentFinancialCommandLease(input: {
  db: PrismaClient;
  contaId: string;
  targetSubscriptionId: string;
  claimToken: string;
}) {
  await input.db.billingAgreement.updateMany({
    where: {
      contaId: input.contaId,
      asaasSubscriptionId: input.targetSubscriptionId,
      mutationLeaseToken: input.claimToken,
    },
    data: { mutationLeaseToken: null, mutationLeaseExpiresAt: null },
  });
}

/** Renews both sides of the cross-outbox claim; loss is fail-closed. */
export function startEnrollmentFinancialCommandLeaseHeartbeat(input: {
  db: PrismaClient;
  contaId: string;
  targetSubscriptionId: string;
  eventId: string;
  claimToken: string;
  leaseMs?: number;
  intervalMs?: number;
}) {
  const leaseMs = input.leaseMs ?? 5 * 60_000;
  let stopped = false;
  let lost = false;
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped || lost) return;
    renewal = renewal.then(async () => {
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const renewed = await input.db.$transaction(async (tx) => {
        const agreement = await tx.billingAgreement.updateMany({
          where: { contaId: input.contaId, asaasSubscriptionId: input.targetSubscriptionId, mutationLeaseToken: input.claimToken, mutationLeaseExpiresAt: { gt: now } },
          data: { mutationLeaseExpiresAt: leaseExpiresAt },
        });
        if (agreement.count !== 1) return false;
        const event = await tx.matriculaBillingOutbox.updateMany({
          where: { id: input.eventId, contaId: input.contaId, status: MatriculaBillingOutboxStatus.PROCESSING, claimToken: input.claimToken, leaseExpiresAt: { gt: now } },
          data: { leaseExpiresAt, lockedAt: now },
        });
        return event.count === 1;
      });
      if (!renewed) lost = true;
    }).catch(() => { lost = true; });
  }, input.intervalMs ?? Math.max(1_000, Math.floor(leaseMs / 3)));
  timer.unref?.();
  return {
    async assertOwned() {
      await renewal;
      if (lost) throw new Error('ENROLLMENT_FINANCIAL_COMMAND_LEASE_LOST');
      const now = new Date();
      const [agreementCount, eventCount] = await Promise.all([
        input.db.billingAgreement.count({
          where: {
            contaId: input.contaId,
            asaasSubscriptionId: input.targetSubscriptionId,
            mutationLeaseToken: input.claimToken,
            mutationLeaseExpiresAt: { gt: now },
          },
        }),
        input.db.matriculaBillingOutbox.count({
          where: {
            id: input.eventId,
            contaId: input.contaId,
            status: MatriculaBillingOutboxStatus.PROCESSING,
            claimToken: input.claimToken,
            leaseExpiresAt: { gt: now },
          },
        }),
      ]);
      if (agreementCount !== 1 || eventCount !== 1) {
        lost = true;
        throw new Error('ENROLLMENT_FINANCIAL_COMMAND_LEASE_LOST');
      }
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await renewal;
    },
  };
}
