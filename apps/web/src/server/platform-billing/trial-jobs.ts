import { Prisma, NotificationCategory, NotificationSeverity, NotificationType, Role, type PrismaClient } from '@prisma/client';
import { createNotification } from '@alusa/lib';
import type { PlatformBillingEnvironment } from '@alusa/platform-billing';
import { resolvePlatformBillingEnvironment } from './platform-billing-server';

export type ExpirePlatformBillingTrialsResult = {
  checked: number;
  restricted: number;
  notified: number;
};

/**
 * Enforces the product rule that an unpaid trial has no grace period.
 * This job is a persistence/reconciliation backstop; the request-time access
 * policy also derives RESTRICTED as soon as trialEndsAt is reached.
 */
export async function expirePlatformBillingTrials(input: {
  prisma: PrismaClient;
  limit?: number;
  now?: Date;
  environment?: PlatformBillingEnvironment;
}): Promise<ExpirePlatformBillingTrialsResult> {
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200));
  const accounts = await input.prisma.platformBillingAccount.findMany({
    where: {
      environment,
      status: 'TRIALING',
      trialEndsAt: { lte: now },
      accessStatus: { not: 'CANCELED' },
    },
    orderBy: { trialEndsAt: 'asc' },
    take: limit,
    select: {
      id: true,
      contaId: true,
      planCode: true,
      stripeSubscriptionId: true,
      trialEndsAt: true,
    },
  });

  let restricted = 0;
  let notified = 0;

  for (const account of accounts) {
    const changed = await input.prisma.$transaction(async (tx) => {
      const update = await tx.platformBillingAccount.updateMany({
        where: {
          id: account.id,
          status: 'TRIALING',
          trialEndsAt: { lte: now },
          accessStatus: { not: 'CANCELED' },
        },
        data: {
          accessStatus: 'RESTRICTED',
          restrictedAt: now,
        },
      });

      if (update.count === 0) return false;

      await tx.platformBillingAuditLog.create({
        data: {
          contaId: account.contaId,
          billingAccountId: account.id,
          actorUserId: null,
          action: 'PLATFORM_BILLING_TRIAL_EXPIRED_RESTRICTED',
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

      await tx.platformBillingIssue.upsert({
        where: {
          uq_platform_billing_issue_env_fingerprint: {
            environment,
            fingerprint: `${account.id}:trial-expired`,
          },
        },
        create: {
          contaId: account.contaId,
          billingAccountId: account.id,
          environment,
          severity: 'CRITICAL',
          status: 'OPEN',
          code: 'TRIAL_EXPIRED_WITHOUT_PAYMENT',
          title: 'Período gratuito encerrado',
          message: 'O período gratuito terminou sem uma assinatura paga. A conta entrou em acesso restrito.',
          fingerprint: `${account.id}:trial-expired`,
          details: {
            planCode: account.planCode,
            trialEndsAt: account.trialEndsAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
          correlationId: account.stripeSubscriptionId ?? account.id,
        },
        update: {
          severity: 'CRITICAL',
          status: 'OPEN',
          detectedAt: now,
          resolvedAt: null,
          ignoredAt: null,
          title: 'Período gratuito encerrado',
          message: 'O período gratuito terminou sem uma assinatura paga. A conta entrou em acesso restrito.',
          details: {
            planCode: account.planCode,
            trialEndsAt: account.trialEndsAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
          correlationId: account.stripeSubscriptionId ?? account.id,
        },
      });

      return true;
    });

    if (!changed) continue;
    restricted += 1;

    try {
      const notification = await createNotification({
        contaId: account.contaId,
        type: NotificationType.SYSTEM_ATTENTION,
        category: NotificationCategory.SYSTEM,
        severity: NotificationSeverity.CRITICAL,
        title: 'Seu período gratuito terminou',
        message: 'Cadastre um cartão para continuar usando as operações da Alusa.',
        dedupeKey: `platform-billing:trial-expired:${account.id}`,
        relatedPath: '/conta/plano-faturamento',
        entityType: 'PlatformBillingAccount',
        entityId: account.id,
        sourceType: 'Stripe',
        sourceId: account.stripeSubscriptionId ?? account.id,
        metadata: {
          environment,
          planCode: account.planCode,
          trialEndsAt: account.trialEndsAt?.toISOString() ?? null,
        },
        actor: { type: 'SYSTEM' },
        recipientRoles: [Role.ADMIN, Role.FINANCEIRO],
      });
      if (notification.notificationId) notified += 1;
    } catch (error) {
      console.warn('[platform-billing][trial] notification_failed', {
        contaId: account.contaId,
        accountId: account.id,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      });
    }
  }

  return { checked: accounts.length, restricted, notified };
}
