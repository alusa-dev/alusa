import {
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { runWithTenant } from '@/lib/prisma-tenant';
import type { PlatformBillingEnvironment } from '@alusa/platform-billing';
import { resolvePlatformBillingEnvironment } from './platform-billing-server';

export type ExpirePlatformBillingTrialsResult = {
  checked: number;
  detected: number;
  notificationQueued: number;
};

const EXPIRABLE_TRIAL_STATUSES = ['TRIALING', 'PAUSED', 'UNPAID', 'ACTIVE'] as const;
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Detects unpaid trial expiration, registers audit and notification intent.
 * Only accounts without an open expiration issue are selected, so each run
 * caps total work at `limit` and later runs advance to other overdue trials.
 * Every issue/audit/outbox write runs under that Conta's RLS transaction.
 */
export async function expirePlatformBillingTrials(input: {
  prisma?: PrismaClient;
  limit?: number;
  now?: Date;
  environment?: PlatformBillingEnvironment;
}): Promise<ExpirePlatformBillingTrialsResult> {
  const db = input.prisma ?? defaultPrisma;
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200));
  let detected = 0;
  let notificationQueued = 0;
  const where: Prisma.PlatformBillingAccountWhereInput = {
      environment,
      status: { in: [...EXPIRABLE_TRIAL_STATUSES] },
      trialEndsAt: { lte: now },
      firstPaidAt: null,
      lastSuccessfulPaymentAt: null,
      conta: { is: { status: 'ATIVO', deletedAt: null } },
      // The issue and notification are written atomically. Excluding open
      // issues lets the next invocation make progress without a global scan.
      issues: { none: { environment, code: 'TRIAL_EXPIRED_WITHOUT_PAYMENT', status: 'OPEN' } },
    };
  const eligibleCount = await db.platformBillingAccount.count({ where });
  // The cron runs every five minutes. Rotate the starting offset by one page
  // each interval so stale candidates that remain eligible cannot permanently
  // occupy the first page. Successful candidates leave the set via the issue
  // above; the time-based offset handles candidates whose tenant transaction
  // did not complete, without introducing persisted cursor state.
  const rotationWindow = Math.floor(now.getTime() / MAINTENANCE_INTERVAL_MS);
  const skip = eligibleCount > limit ? (rotationWindow * limit) % eligibleCount : 0;
  const candidates = await db.platformBillingAccount.findMany({
    where,
    orderBy: [{ trialEndsAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    skip,
    take: limit,
    select: {
      id: true,
      contaId: true,
      planCode: true,
      stripeSubscriptionId: true,
      trialEndsAt: true,
    },
  });
  const checked = candidates.length;

  for (const candidate of candidates) {
    const contaId = candidate.contaId;
    // Lock the billing row before the final re-read. Webhook updates lock
    // the same row, so they either commit first and suppress this issue,
    // or commit afterward and resolve the issue opened here.
    const verified = await runWithTenant(contaId, async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "PlatformBillingAccount"
        WHERE "id" = ${candidate.id}
          AND "contaId" = ${contaId}
          AND "environment" = ${environment}::"PlatformBillingEnvironment"
        FOR UPDATE
      `;
      if (lockedRows.length === 0) return null;
      const account = await tx.platformBillingAccount.findFirst({
        where: eligibleExpiredTrialWhere({
          contaId,
          environment,
          now,
          accountId: candidate.id,
        }),
        select: {
          id: true,
          contaId: true,
          planCode: true,
          stripeSubscriptionId: true,
          trialEndsAt: true,
        },
      });
      if (!account) return null;

      const fingerprint = `${account.id}:trial-expired`;
      const issueData = {
        contaId,
        billingAccountId: account.id,
        environment,
        severity: 'CRITICAL' as const,
        status: 'OPEN' as const,
        code: 'TRIAL_EXPIRED_WITHOUT_PAYMENT',
        title: 'Período gratuito encerrado',
        message: 'O período gratuito terminou sem uma assinatura paga. O acesso às operações de escrita é derivado da política de faturamento.',
        fingerprint,
        details: {
          planCode: account.planCode,
          trialEndsAt: account.trialEndsAt?.toISOString() ?? null,
        } as Prisma.InputJsonValue,
        correlationId: account.stripeSubscriptionId ?? account.id,
      };
      const issueClaim = await tx.platformBillingIssue.createMany({
        data: [issueData],
        skipDuplicates: true,
      });

      if (issueClaim.count > 0) {
        await tx.platformBillingAuditLog.create({
          data: {
            contaId,
            billingAccountId: account.id,
            actorUserId: null,
            action: 'PLATFORM_BILLING_TRIAL_EXPIRED_DETECTED',
            entityType: 'PlatformBillingAccount',
            entityId: account.id,
            correlationId: account.stripeSubscriptionId ?? account.id,
            metadata: {
              environment,
              planCode: account.planCode,
              trialEndsAt: account.trialEndsAt?.toISOString() ?? null,
            },
          },
        });
      }

      await tx.platformBillingIssue.upsert({
        where: {
          uq_platform_billing_issue_env_fingerprint: { environment, fingerprint },
        },
        update: {
          severity: 'CRITICAL',
          status: 'OPEN',
          detectedAt: now,
          resolvedAt: null,
          ignoredAt: null,
          title: issueData.title,
          message: issueData.message,
          details: issueData.details,
          correlationId: issueData.correlationId,
        },
        create: issueData,
      });

      const notice = await tx.platformBillingNotificationOutbox.createMany({
        data: [{
          environment,
          eventId: `trial-expired:${account.id}`,
          eventType: 'platform.billing_trial_expired',
          contaId,
        }],
        skipDuplicates: true,
      });

      return { notificationQueued: notice.count > 0 };
    });
    if (!verified) continue;
    detected += 1;
    if (verified.notificationQueued) notificationQueued += 1;
  }

  return { checked, detected, notificationQueued };
}

function eligibleExpiredTrialWhere(input: {
  contaId: string;
  environment: PlatformBillingEnvironment;
  now: Date;
  accountId?: string;
}): Prisma.PlatformBillingAccountWhereInput {
  return {
    ...(input.accountId ? { id: input.accountId } : {}),
    contaId: input.contaId,
    environment: input.environment,
    status: { in: [...EXPIRABLE_TRIAL_STATUSES] },
    trialEndsAt: { lte: input.now },
    firstPaidAt: null,
    lastSuccessfulPaymentAt: null,
  };
}
