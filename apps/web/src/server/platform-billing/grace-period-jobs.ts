import { Prisma, NotificationCategory, NotificationSeverity, NotificationType, Role, type PrismaClient } from '@prisma/client';
import { createNotification } from '@alusa/lib';
import type { PlatformBillingEnvironment } from '@alusa/platform-billing';
import { resolvePlatformBillingEnvironment } from './platform-billing-server';

export type ExpirePlatformBillingGracePeriodsResult = {
  checked: number;
  restricted: number;
  notified: number;
};

export async function expirePlatformBillingGracePeriods(input: {
  prisma: PrismaClient;
  limit?: number;
  now?: Date;
  environment?: PlatformBillingEnvironment;
}): Promise<ExpirePlatformBillingGracePeriodsResult> {
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const accounts = await input.prisma.platformBillingAccount.findMany({
    where: {
      environment,
      accessStatus: 'GRACE_PERIOD',
      gracePeriodEndsAt: { lte: now },
      status: { not: 'CANCELED' },
    },
    orderBy: { gracePeriodEndsAt: 'asc' },
    take: limit,
    select: {
      id: true,
      contaId: true,
      environment: true,
      status: true,
      planCode: true,
      stripeSubscriptionId: true,
      gracePeriodEndsAt: true,
    },
  });

  let restricted = 0;
  let notified = 0;

  for (const account of accounts) {
    const updated = await input.prisma.$transaction(async (tx) => {
      const update = await tx.platformBillingAccount.updateMany({
        where: {
          id: account.id,
          accessStatus: 'GRACE_PERIOD',
          gracePeriodEndsAt: { lte: now },
        },
        data: {
          accessStatus: 'RESTRICTED',
          restrictedAt: now,
          pendingChangeType: 'PAYMENT_RECOVERY',
        },
      });

      if (update.count === 0) return false;

      await tx.platformBillingAuditLog.create({
        data: {
          contaId: account.contaId,
          billingAccountId: account.id,
          actorUserId: null,
          action: 'PLATFORM_BILLING_GRACE_PERIOD_EXPIRED',
          entityType: 'PlatformBillingAccount',
          entityId: account.id,
          correlationId: account.stripeSubscriptionId ?? account.id,
          metadata: {
            environment,
            planCode: account.planCode,
            gracePeriodEndsAt: account.gracePeriodEndsAt?.toISOString() ?? null,
          },
        },
      });

      await tx.platformBillingIssue.upsert({
        where: {
          uq_platform_billing_issue_env_fingerprint: {
            environment,
            fingerprint: `${account.id}:grace-period-expired`,
          },
        },
        create: {
          contaId: account.contaId,
          billingAccountId: account.id,
          environment,
          severity: 'CRITICAL',
          status: 'OPEN',
          code: 'GRACE_PERIOD_EXPIRED',
          title: 'Conta restrita por pagamento pendente',
          message: 'O período de regularização expirou e a Conta entrou em acesso restrito.',
          fingerprint: `${account.id}:grace-period-expired`,
          details: {
            planCode: account.planCode,
            gracePeriodEndsAt: account.gracePeriodEndsAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
          correlationId: account.stripeSubscriptionId ?? account.id,
        },
        update: {
          severity: 'CRITICAL',
          status: 'OPEN',
          title: 'Conta restrita por pagamento pendente',
          message: 'O período de regularização expirou e a Conta entrou em acesso restrito.',
          detectedAt: now,
          resolvedAt: null,
          ignoredAt: null,
          details: {
            planCode: account.planCode,
            gracePeriodEndsAt: account.gracePeriodEndsAt?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
          correlationId: account.stripeSubscriptionId ?? account.id,
        },
      });

      return true;
    });

    if (!updated) continue;
    restricted += 1;

    try {
      const notification = await createNotification({
        contaId: account.contaId,
        type: NotificationType.SYSTEM_ATTENTION,
        category: NotificationCategory.SYSTEM,
        severity: NotificationSeverity.CRITICAL,
        title: 'Conta restrita por pagamento pendente',
        message: 'Regularize a assinatura da Alusa para liberar novas escritas na plataforma.',
        dedupeKey: `platform-billing:grace-expired:${account.id}`,
        relatedPath: '/conta/plano-faturamento',
        entityType: 'PlatformBillingAccount',
        entityId: account.id,
        sourceType: 'Stripe',
        sourceId: account.stripeSubscriptionId ?? account.id,
        metadata: {
          environment,
          planCode: account.planCode,
          gracePeriodEndsAt: account.gracePeriodEndsAt?.toISOString() ?? null,
        },
        actor: { type: 'SYSTEM' },
        recipientRoles: [Role.ADMIN, Role.FINANCEIRO],
      });
      if (notification.notificationId) notified += 1;
    } catch (error) {
      console.warn('[platform-billing][grace-period] notification_failed', {
        contaId: account.contaId,
        accountId: account.id,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      });
    }

    console.info('[platform-billing][grace-period]', {
      event: 'grace_period_expired',
      contaId: account.contaId,
      accountId: account.id,
      environment,
    });
  }

  return {
    checked: accounts.length,
    restricted,
    notified,
  };
}
