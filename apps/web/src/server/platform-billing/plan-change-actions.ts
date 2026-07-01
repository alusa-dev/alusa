import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PLATFORM_PLANS,
  PlatformBillingError,
  createDefaultPlatformBillingStripeGateway,
  evaluateStudentCapacity,
  resolveStripePriceId,
  type PlatformPlanCode,
  type PublicPlatformPlanCode,
} from '@alusa/platform-billing';
import { resolvePlatformBillingEnvironment } from './platform-billing-server';

const PLAN_RANK: Record<PublicPlatformPlanCode, number> = {
  STARTER: 1,
  PREMIUM: 2,
  PRO: 3,
};

export async function requestPlatformPlanChange(input: {
  prisma: PrismaClient;
  contaId: string;
  actorUserId: string;
  targetPlanCode: PublicPlatformPlanCode;
  idempotencyKey?: string;
}): Promise<{
  planChangeId: string;
  type: 'UPGRADE' | 'DOWNGRADE';
  status: 'PENDING_PAYMENT' | 'PENDING_EFFECTIVE_DATE';
  effectiveAt: string | null;
  preview?: { amountDue: number; amountRemaining: number; currency: string };
}> {
  const environment = resolvePlatformBillingEnvironment();
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
  const existing = await input.prisma.platformBillingPlanChange.findUnique({
    where: {
      uq_platform_billing_plan_change_idempotency: {
        contaId: input.contaId,
        environment,
        idempotencyKey,
      },
    },
  });
  if (existing) {
    return {
      planChangeId: existing.id,
      type: existing.type as 'UPGRADE' | 'DOWNGRADE',
      status: existing.status as 'PENDING_PAYMENT' | 'PENDING_EFFECTIVE_DATE',
      effectiveAt: existing.effectiveAt?.toISOString() ?? null,
    };
  }

  const account = await input.prisma.platformBillingAccount.findUnique({
    where: {
      uq_platform_billing_account_conta_env: {
        contaId: input.contaId,
        environment,
      },
    },
  });

  if (!account?.stripeSubscriptionId || !account.planCode || account.planCode === 'CUSTOM') {
    throw new PlatformBillingError(
      'Active Stripe subscription is required before changing plan.',
      'PLATFORM_BILLING_SUBSCRIPTION_MISSING',
      { contaId: input.contaId, environment },
    );
  }

  if (account.planCode === input.targetPlanCode) {
    throw new PlatformBillingError(
      'Target plan is already active.',
      'PLATFORM_BILLING_PLAN_CHANGE_INVALID',
      { contaId: input.contaId, planCode: account.planCode },
    );
  }

  const currentRank = PLAN_RANK[account.planCode as PublicPlatformPlanCode];
  const targetRank = PLAN_RANK[input.targetPlanCode];
  const type = targetRank > currentRank ? 'UPGRADE' : 'DOWNGRADE';
  const stripePriceId = resolveStripePriceId({
    planCode: input.targetPlanCode,
    environment,
    source: process.env,
  });

  if (type === 'DOWNGRADE') {
    const activeStudents = await countActiveStudents(input.prisma, input.contaId);
    const capacity = evaluateStudentCapacity({
      contaId: input.contaId,
      planCode: input.targetPlanCode,
      activeStudents,
      additionalActiveStudents: 0,
    });
    if (!capacity.allowed) {
      throw new PlatformBillingError(
        'Current active students are not compatible with the target plan.',
        'PLATFORM_BILLING_PLAN_CHANGE_INCOMPATIBLE',
        { ...capacity },
      );
    }

    const planChange = await input.prisma.platformBillingPlanChange.create({
      data: {
        contaId: input.contaId,
        billingAccountId: account.id,
        environment,
        type,
        status: 'PENDING_EFFECTIVE_DATE',
        fromPlanCode: account.planCode as PlatformPlanCode,
        toPlanCode: input.targetPlanCode,
        stripeSubscriptionId: account.stripeSubscriptionId,
        stripePriceId,
        effectiveAt: account.currentPeriodEnd,
        idempotencyKey,
        createdByUserId: input.actorUserId,
        correlationId: idempotencyKey,
        metadata: {
          activeStudents,
          targetPlanMaxActiveStudents: PLATFORM_PLANS[input.targetPlanCode].maxActiveStudents,
        },
      },
    });

    await input.prisma.platformBillingAccount.update({
      where: { id: account.id },
      data: {
        pendingPlanCode: input.targetPlanCode,
        pendingChangeType: 'DOWNGRADE',
        pendingChangeEffectiveAt: account.currentPeriodEnd,
      },
    });

    await auditPlanChange(input.prisma, {
      contaId: input.contaId,
      billingAccountId: account.id,
      actorUserId: input.actorUserId,
      action: 'PLATFORM_BILLING_DOWNGRADE_SCHEDULED',
      entityId: planChange.id,
      correlationId: idempotencyKey,
      metadata: { fromPlanCode: account.planCode, toPlanCode: input.targetPlanCode },
    });

    return {
      planChangeId: planChange.id,
      type,
      status: 'PENDING_EFFECTIVE_DATE',
      effectiveAt: account.currentPeriodEnd?.toISOString() ?? null,
    };
  }

  const planChange = await input.prisma.platformBillingPlanChange.create({
    data: {
      contaId: input.contaId,
      billingAccountId: account.id,
      environment,
      type,
      status: 'PENDING_PAYMENT',
      fromPlanCode: account.planCode as PlatformPlanCode,
      toPlanCode: input.targetPlanCode,
      stripeSubscriptionId: account.stripeSubscriptionId,
      stripePriceId,
      idempotencyKey,
      createdByUserId: input.actorUserId,
      correlationId: idempotencyKey,
    },
  });

  const gateway = createDefaultPlatformBillingStripeGateway(process.env);
  try {
    const preview = await gateway.previewSubscriptionPlanChange({
      subscriptionId: account.stripeSubscriptionId,
      priceId: stripePriceId,
      idempotencyKey: `${idempotencyKey}:preview`,
    });
    const updatedSubscription = await gateway.updateSubscriptionPlan({
      subscriptionId: account.stripeSubscriptionId,
      priceId: stripePriceId,
      paymentBehavior: 'pending_if_incomplete',
      prorationBehavior: 'always_invoice',
      metadata: {
        contaId: input.contaId,
        planCode: input.targetPlanCode,
        billingContext: 'platform',
        planChangeId: planChange.id,
      },
      idempotencyKey: `${idempotencyKey}:stripe-upgrade`,
    });

    const previewMetadata = {
      ...preview,
      nextPaymentAttempt: preview.nextPaymentAttempt?.toISOString() ?? null,
    };

    await input.prisma.platformBillingPlanChange.update({
      where: { id: planChange.id },
      data: {
        stripePendingUpdateId: updatedSubscription.pendingUpdateId,
        metadata: {
          preview: previewMetadata,
          stripeSubscriptionStatus: updatedSubscription.status,
        } as Prisma.InputJsonValue,
      },
    });

    await input.prisma.platformBillingAccount.update({
      where: { id: account.id },
      data: {
        pendingPlanCode: input.targetPlanCode,
        pendingChangeType: 'UPGRADE',
        pendingChangeEffectiveAt: null,
      },
    });

    await auditPlanChange(input.prisma, {
      contaId: input.contaId,
      billingAccountId: account.id,
      actorUserId: input.actorUserId,
      action: 'PLATFORM_BILLING_UPGRADE_REQUESTED',
      entityId: planChange.id,
      correlationId: idempotencyKey,
      metadata: {
        fromPlanCode: account.planCode,
        toPlanCode: input.targetPlanCode,
        preview: previewMetadata,
      },
    });

    return {
      planChangeId: planChange.id,
      type,
      status: 'PENDING_PAYMENT',
      effectiveAt: null,
      preview: {
        amountDue: preview.amountDue,
        amountRemaining: preview.amountRemaining,
        currency: preview.currency,
      },
    };
  } catch (error) {
    await input.prisma.platformBillingPlanChange.update({
      where: { id: planChange.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      },
    });
    throw error;
  }
}

export async function requestPlatformSubscriptionCancellation(input: {
  prisma: PrismaClient;
  contaId: string;
  actorUserId: string;
  idempotencyKey?: string;
}): Promise<{ cancelAtPeriodEnd: true; effectiveAt: string | null }> {
  const environment = resolvePlatformBillingEnvironment();
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
  const account = await input.prisma.platformBillingAccount.findUnique({
    where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment } },
  });
  if (!account?.stripeSubscriptionId) {
    throw new PlatformBillingError(
      'Active Stripe subscription is required before canceling.',
      'PLATFORM_BILLING_SUBSCRIPTION_MISSING',
      { contaId: input.contaId, environment },
    );
  }

  const gateway = createDefaultPlatformBillingStripeGateway(process.env);
  await gateway.updateSubscriptionCancelAtPeriodEnd({
    subscriptionId: account.stripeSubscriptionId,
    cancelAtPeriodEnd: true,
    metadata: {
      contaId: input.contaId,
      billingContext: 'platform',
      cancelRequestedByUserId: input.actorUserId,
    },
    idempotencyKey: `${idempotencyKey}:stripe-cancel`,
  });

  await input.prisma.platformBillingAccount.update({
    where: { id: account.id },
    data: {
      cancelAtPeriodEnd: true,
      pendingChangeType: 'CANCEL_AT_PERIOD_END',
      pendingChangeEffectiveAt: account.currentPeriodEnd,
    },
  });

  await input.prisma.platformBillingPlanChange.create({
    data: {
      contaId: input.contaId,
      billingAccountId: account.id,
      environment,
      type: 'CANCEL_AT_PERIOD_END',
      status: 'PENDING_EFFECTIVE_DATE',
      fromPlanCode: account.planCode,
      effectiveAt: account.currentPeriodEnd,
      stripeSubscriptionId: account.stripeSubscriptionId,
      idempotencyKey,
      createdByUserId: input.actorUserId,
      correlationId: idempotencyKey,
    },
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
    throw error;
  });

  await auditPlanChange(input.prisma, {
    contaId: input.contaId,
    billingAccountId: account.id,
    actorUserId: input.actorUserId,
    action: 'PLATFORM_BILLING_CANCEL_AT_PERIOD_END_REQUESTED',
    entityId: account.id,
    correlationId: idempotencyKey,
  });

  return {
    cancelAtPeriodEnd: true,
    effectiveAt: account.currentPeriodEnd?.toISOString() ?? null,
  };
}

export async function undoPlatformSubscriptionCancellation(input: {
  prisma: PrismaClient;
  contaId: string;
  actorUserId: string;
  idempotencyKey?: string;
}): Promise<{ cancelAtPeriodEnd: false }> {
  const environment = resolvePlatformBillingEnvironment();
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
  const account = await input.prisma.platformBillingAccount.findUnique({
    where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment } },
  });
  if (!account?.stripeSubscriptionId) {
    throw new PlatformBillingError(
      'Active Stripe subscription is required before undoing cancellation.',
      'PLATFORM_BILLING_SUBSCRIPTION_MISSING',
      { contaId: input.contaId, environment },
    );
  }

  const gateway = createDefaultPlatformBillingStripeGateway(process.env);
  await gateway.updateSubscriptionCancelAtPeriodEnd({
    subscriptionId: account.stripeSubscriptionId,
    cancelAtPeriodEnd: false,
    metadata: {
      contaId: input.contaId,
      billingContext: 'platform',
      cancelRevertedByUserId: input.actorUserId,
    },
    idempotencyKey: `${idempotencyKey}:stripe-undo-cancel`,
  });

  await input.prisma.$transaction(async (tx) => {
    await tx.platformBillingAccount.update({
      where: { id: account.id },
      data: {
        cancelAtPeriodEnd: false,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      },
    });
    await tx.platformBillingPlanChange.updateMany({
      where: {
        billingAccountId: account.id,
        type: 'CANCEL_AT_PERIOD_END',
        status: 'PENDING_EFFECTIVE_DATE',
      },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
      },
    });
  });

  await auditPlanChange(input.prisma, {
    contaId: input.contaId,
    billingAccountId: account.id,
    actorUserId: input.actorUserId,
    action: 'PLATFORM_BILLING_CANCEL_AT_PERIOD_END_REVERTED',
    entityId: account.id,
    correlationId: idempotencyKey,
  });

  return { cancelAtPeriodEnd: false };
}

export async function applyDuePlatformPlanChanges(input: {
  prisma: PrismaClient;
  limit?: number;
}): Promise<{ checked: number; submitted: number; failed: number }> {
  const environment = resolvePlatformBillingEnvironment();
  const now = new Date();
  const dueChanges = await input.prisma.platformBillingPlanChange.findMany({
    where: {
      environment,
      type: 'DOWNGRADE',
      status: 'PENDING_EFFECTIVE_DATE',
      effectiveAt: { lte: now },
    },
    orderBy: { effectiveAt: 'asc' },
    take: Math.max(1, Math.min(input.limit ?? 25, 100)),
    include: { billingAccount: true },
  });

  const gateway = createDefaultPlatformBillingStripeGateway(process.env);
  let submitted = 0;
  let failed = 0;

  for (const change of dueChanges) {
    const targetPlanCode = change.toPlanCode as PublicPlatformPlanCode | null;
    const account = change.billingAccount;
    if (!targetPlanCode || !account.stripeSubscriptionId) {
      await markPlanChangeFailed(input.prisma, change.id, 'Downgrade missing target plan or Stripe subscription.');
      failed += 1;
      continue;
    }

    const activeStudents = await countActiveStudents(input.prisma, change.contaId);
    const capacity = evaluateStudentCapacity({
      contaId: change.contaId,
      planCode: targetPlanCode,
      activeStudents,
      additionalActiveStudents: 0,
    });
    if (!capacity.allowed) {
      await markPlanChangeFailed(input.prisma, change.id, 'Account is no longer eligible for scheduled downgrade.');
      await input.prisma.platformBillingIssue.create({
        data: {
          contaId: change.contaId,
          billingAccountId: account.id,
          environment,
          severity: 'WARNING',
          status: 'OPEN',
          code: 'DOWNGRADE_NOT_ELIGIBLE',
          title: 'Downgrade agendado perdeu elegibilidade',
          message: 'A Conta possui alunos ativos acima do limite do plano agendado.',
          fingerprint: `${change.id}:downgrade-not-eligible`,
          details: { ...capacity } as Prisma.InputJsonValue,
          correlationId: change.correlationId,
        },
      }).catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
        throw error;
      });
      failed += 1;
      continue;
    }

    const stripePriceId = resolveStripePriceId({
      planCode: targetPlanCode,
      environment,
      source: process.env,
    });
    await gateway.updateSubscriptionPlan({
      subscriptionId: account.stripeSubscriptionId,
      priceId: stripePriceId,
      paymentBehavior: 'allow_incomplete',
      prorationBehavior: 'none',
      metadata: {
        contaId: change.contaId,
        planCode: targetPlanCode,
        billingContext: 'platform',
        planChangeId: change.id,
      },
      idempotencyKey: `${change.id}:stripe-downgrade`,
    });

    await input.prisma.platformBillingPlanChange.update({
      where: { id: change.id },
      data: {
        status: 'PENDING_PAYMENT',
        stripePriceId,
        metadata: {
          submittedAt: now.toISOString(),
          activeStudents,
        } as Prisma.InputJsonValue,
      },
    });

    submitted += 1;
  }

  return {
    checked: dueChanges.length,
    submitted,
    failed,
  };
}

async function markPlanChangeFailed(prisma: PrismaClient, id: string, message: string): Promise<void> {
  await prisma.platformBillingPlanChange.update({
    where: { id },
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      lastError: message,
    },
  });
}

async function auditPlanChange(
  prisma: PrismaClient,
  input: {
    contaId: string;
    billingAccountId: string;
    actorUserId: string;
    action: string;
    entityId: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.platformBillingAuditLog.create({
    data: {
      contaId: input.contaId,
      billingAccountId: input.billingAccountId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: 'PlatformBillingPlanChange',
      entityId: input.entityId,
      correlationId: input.correlationId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

async function countActiveStudents(prisma: PrismaClient, contaId: string): Promise<number> {
  const rows = await prisma.matricula.findMany({
    where: {
      contaId,
      status: 'ATIVA',
      aluno: { status: 'ATIVO' },
    },
    distinct: ['alunoId'],
    select: { alunoId: true },
  });

  return rows.length;
}
