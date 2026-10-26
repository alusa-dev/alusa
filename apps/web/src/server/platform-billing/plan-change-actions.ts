import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PLATFORM_PLANS,
  PlatformBillingError,
  createDefaultPlatformBillingStripeGateway,
  getSchoolPriceBandRank,
  resolveStableSchoolPriceBand,
  resolveSchoolCommercialTarget,
  isPublicPlatformPlanCode,
  evaluateStudentCapacity,
  resolveStripePriceId,
  schedulePlatformBillingDowngrade,
  type PlatformPlanCode,
  type PublicPlatformPlanCode,
} from '@alusa/platform-billing';
import { countActivePlatformBillingStudents, resolvePlatformBillingEnvironment } from './platform-billing-server';
import { runWithTenant } from '@/lib/prisma-tenant';
import { logApiOperationalEvent } from '@/lib/observability/api-logger';

const LEGACY_PLAN_RANK: Record<'STARTER' | 'PREMIUM' | 'PRO' | 'CUSTOM', number> = {
  STARTER: 0,
  PREMIUM: 2,
  PRO: 6,
  CUSTOM: 0,
};

export function getPlatformPlanRank(code: PlatformPlanCode): number {
  return isPublicPlatformPlanCode(code) ? getSchoolPriceBandRank(code) : LEGACY_PLAN_RANK[code];
}

type PlatformPlanChangeResponse = {
  planChangeId: string;
  type: 'UPGRADE' | 'DOWNGRADE';
  status: 'PENDING_PAYMENT' | 'PENDING_EFFECTIVE_DATE' | 'APPLIED';
  effectiveAt: string | null;
  message?: string;
  detail?: string | null;
  preview?: { amountDue: number; amountRemaining: number; currency: string };
};

type PlatformPlanChangeReplayRecord = {
  id: string;
  type: string;
  status: string;
  fromPlanCode: string | null;
  toPlanCode: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  effectiveAt: Date | null;
  metadata: Prisma.JsonValue;
};

export async function requestPlatformPlanChange(input: {
  prisma: PrismaClient;
  contaId: string;
  actorUserId: string;
  targetPlanCode: PublicPlatformPlanCode;
  idempotencyKey: string;
}): Promise<PlatformPlanChangeResponse> {
  const environment = resolvePlatformBillingEnvironment();
  const idempotencyKey = requirePlatformBillingIdempotencyKey(input.idempotencyKey);
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
    if (existing.type === 'UPGRADE' && existing.status === 'PENDING_PAYMENT') {
      if (existing.toPlanCode !== input.targetPlanCode || !existing.stripeSubscriptionId || !existing.stripePriceId) {
        throw new PlatformBillingError('Stored upgrade cannot be safely replayed.', 'PLATFORM_BILLING_REPLAY_INVALID', { idempotencyKey });
      }
      const account = await input.prisma.platformBillingAccount.findUnique({
        where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment } },
      });
      if (!account || account.stripeSubscriptionId !== existing.stripeSubscriptionId) {
        throw new PlatformBillingError('Subscription changed after upgrade request; reconcile the plan change.', 'PLATFORM_BILLING_REPLAY_INVALID', { idempotencyKey });
      }
      return requestPendingPlatformUpgrade({
        prisma: input.prisma,
        gateway: createDefaultPlatformBillingStripeGateway(process.env),
        account,
        planChange: existing,
        contaId: input.contaId,
        actorUserId: input.actorUserId,
        environment,
        idempotencyKey,
        replayed: true,
      });
    }
    if (existing.type === 'DOWNGRADE' && existing.status === 'PENDING_EFFECTIVE_DATE') {
      if (existing.toPlanCode !== input.targetPlanCode || !existing.stripeSubscriptionId || !existing.stripePriceId || !existing.effectiveAt) {
        throw new PlatformBillingError('Stored downgrade cannot be safely replayed.', 'PLATFORM_BILLING_REPLAY_INVALID', { idempotencyKey });
      }
      const account = await input.prisma.platformBillingAccount.findUnique({
        where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment } },
      });
      if (!account || account.stripeSubscriptionId !== existing.stripeSubscriptionId) {
        throw new PlatformBillingError('Subscription changed after downgrade request; reconcile the plan change.', 'PLATFORM_BILLING_REPLAY_INVALID', { idempotencyKey });
      }
      assertTargetBandCoversCurrentUsage(
        input.targetPlanCode,
        await countCurrentBillableStudents(input.contaId),
        input.contaId,
      );
      await scheduleAndPersistPlanChange({
        prisma: input.prisma,
        stripeGateway: createDefaultPlatformBillingStripeGateway(process.env),
        contaId: input.contaId,
        actorUserId: input.actorUserId,
        environment,
        idempotencyKey,
        account,
        planChange: existing,
        activeStudents: readActiveStudents(existing.metadata),
        emitAudit: false,
      });
    }
    return replayPlatformPlanChange(existing, input.targetPlanCode, idempotencyKey);
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

  const snapshots = await input.prisma.platformBillingMonthlySnapshot.findMany({
    where: { contaId: input.contaId, environment },
    orderBy: { periodStart: 'desc' },
    take: 3,
    select: { periodStart: true, candidateBand: true },
  });
  const stableBand = resolveStableSchoolPriceBand({
    currentBand: isPublicPlatformPlanCode(account.planCode) ? account.planCode : null,
    snapshots,
  });
  if (stableBand !== input.targetPlanCode) {
    throw new PlatformBillingError(
      'A new price band must be present in three consecutive monthly closes before it can be applied.',
      'PLATFORM_BILLING_PLAN_CHANGE_NOT_STABLE',
      { contaId: input.contaId, targetPlanCode: input.targetPlanCode },
    );
  }

  const currentBillableStudents = await countCurrentBillableStudents(input.contaId);
  assertTargetBandCoversCurrentUsage(
    input.targetPlanCode,
    currentBillableStudents,
    input.contaId,
  );

  const currentRank = getPlatformPlanRank(account.planCode as PlatformPlanCode);
  const targetRank = getPlatformPlanRank(input.targetPlanCode);
  const type = targetRank > currentRank ? 'UPGRADE' : 'DOWNGRADE';
  const stripePriceId = resolveStripePriceId({
    planCode: input.targetPlanCode,
    environment,
    source: process.env,
  });

  if (account.status === 'TRIALING') {
    const activeStudents = currentBillableStudents;
    const createdPlanChange = await createPlatformPlanChangeWithIdempotency(input.prisma, {
      data: {
        contaId: input.contaId,
        billingAccountId: account.id,
        environment,
        type,
        status: 'APPLIED',
        fromPlanCode: account.planCode as PlatformPlanCode,
        toPlanCode: input.targetPlanCode,
        stripeSubscriptionId: account.stripeSubscriptionId,
        stripePriceId,
        effectiveAt: new Date(),
        idempotencyKey,
        createdByUserId: input.actorUserId,
        correlationId: idempotencyKey,
        appliedAt: new Date(),
        metadata: {
          activeStudents,
          trialEndsAt: account.trialEndsAt?.toISOString() ?? null,
          targetPlanMaxActiveStudents: PLATFORM_PLANS[input.targetPlanCode].maxActiveStudents,
        },
      },
      contaId: input.contaId,
      environment,
      idempotencyKey,
    });
    if (createdPlanChange.replayed) {
      if (createdPlanChange.record.status === 'PENDING_EFFECTIVE_DATE' && createdPlanChange.record.effectiveAt) {
        await scheduleAndPersistPlanChange({
          prisma: input.prisma,
          stripeGateway: createDefaultPlatformBillingStripeGateway(process.env),
          contaId: input.contaId,
          actorUserId: input.actorUserId,
          environment,
          idempotencyKey,
          account,
          planChange: createdPlanChange.record,
          activeStudents,
          emitAudit: false,
        });
      }
      return replayPlatformPlanChange(
        createdPlanChange.record,
        input.targetPlanCode,
        idempotencyKey,
      );
    }
    const planChange = createdPlanChange.record;

    const gateway = createDefaultPlatformBillingStripeGateway(process.env);
    try {
      const updatedSubscription = await gateway.updateSubscriptionPlan({
        subscriptionId: account.stripeSubscriptionId,
        priceId: stripePriceId,
        paymentBehavior: 'allow_incomplete',
        prorationBehavior: 'none',
        metadata: {
          contaId: input.contaId,
          planCode: input.targetPlanCode,
          billingContext: 'platform',
          planChangeId: planChange.id,
          source: 'trial-plan-change',
        },
        idempotencyKey: namespaceStripeIdempotencyKey(environment, input.contaId, `${idempotencyKey}:stripe-trial-plan-change`),
      });

      const trialEndsAt = updatedSubscription.trialEndsAt ?? account.trialEndsAt;
      await input.prisma.platformBillingAccount.update({
        where: { id: account.id },
        data: {
          status: 'TRIALING',
          accessStatus: 'ACTIVE',
          planCode: input.targetPlanCode,
          stripePriceId,
          currentPeriodEnd: updatedSubscription.currentPeriodEnd ?? account.currentPeriodEnd,
          cancelAtPeriodEnd: updatedSubscription.cancelAtPeriodEnd,
          trialEndsAt,
          pendingPlanCode: null,
          pendingChangeType: null,
          pendingChangeEffectiveAt: null,
          pendingChangeOperationId: null,
          pendingChangeClaimToken: null,
          pendingChangeClaimedAt: null,
        },
      });

      await input.prisma.platformBillingPlanChange.update({
        where: { id: planChange.id },
        data: {
          metadata: {
            activeStudents,
            trialEndsAt: trialEndsAt?.toISOString() ?? null,
            stripeSubscriptionStatus: updatedSubscription.status,
            targetPlanMaxActiveStudents: PLATFORM_PLANS[input.targetPlanCode].maxActiveStudents,
          } as Prisma.InputJsonValue,
        },
      });

      await auditPlanChange(input.prisma, {
        contaId: input.contaId,
        billingAccountId: account.id,
        actorUserId: input.actorUserId,
        action: 'PLATFORM_BILLING_TRIAL_PLAN_CHANGED',
        entityId: planChange.id,
        correlationId: idempotencyKey,
        metadata: {
          fromPlanCode: account.planCode,
          toPlanCode: input.targetPlanCode,
          trialEndsAt: trialEndsAt?.toISOString() ?? null,
        },
      });

      return {
        planChangeId: planChange.id,
        type,
        status: 'APPLIED',
        effectiveAt: new Date().toISOString(),
        message: 'Plano alterado com sucesso.',
        detail: trialEndsAt
          ? `Seu teste gratuito continua até ${formatDatePtBr(trialEndsAt)}.`
          : null,
      };
    } catch (error) {
      await input.prisma.platformBillingPlanChange.update({
        where: { id: planChange.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          lastError:
            error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        },
      });
      throw error;
    }
  }

  if (type === 'DOWNGRADE') {
    const activeStudents = currentBillableStudents;
    const createdPlanChange = await createPlatformPlanChangeWithIdempotency(input.prisma, {
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
      contaId: input.contaId,
      environment,
      idempotencyKey,
    });
    if (createdPlanChange.replayed) {
      if (createdPlanChange.record.status === 'PENDING_EFFECTIVE_DATE' && createdPlanChange.record.effectiveAt) {
        await scheduleAndPersistPlanChange({
          prisma: input.prisma,
          stripeGateway: createDefaultPlatformBillingStripeGateway(process.env),
          contaId: input.contaId,
          actorUserId: input.actorUserId,
          environment,
          idempotencyKey,
          account,
          planChange: createdPlanChange.record,
          activeStudents,
          emitAudit: false,
        });
      }
      return replayPlatformPlanChange(
        createdPlanChange.record,
        input.targetPlanCode,
        idempotencyKey,
      );
    }
    const planChange = createdPlanChange.record;

    if (!account.currentPeriodEnd) {
      await markPlanChangeFailed(input.prisma, {
        id: planChange.id,
        contaId: input.contaId,
        environment,
      }, 'Subscription has no current period end for a scheduled downgrade.');
      throw new PlatformBillingError('Subscription renewal date is unavailable.', 'PLATFORM_BILLING_PLAN_CHANGE_INVALID');
    }
    await scheduleAndPersistPlanChange({
      prisma: input.prisma,
      stripeGateway: createDefaultPlatformBillingStripeGateway(process.env),
      contaId: input.contaId,
      actorUserId: input.actorUserId,
      environment,
      idempotencyKey,
      account,
      planChange,
      activeStudents,
      emitAudit: true,
    });

    return {
      planChangeId: planChange.id,
      type,
      status: 'PENDING_EFFECTIVE_DATE',
      effectiveAt: account.currentPeriodEnd?.toISOString() ?? null,
      message: 'Plano alterado com sucesso.',
      detail: account.currentPeriodEnd
        ? `A mudança entra em vigor em ${formatDatePtBr(account.currentPeriodEnd)}.`
        : 'A mudança entra em vigor no próximo ciclo.',
    };
  }

  const createdPlanChange = await createPlatformPlanChangeWithIdempotency(input.prisma, {
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
    contaId: input.contaId,
    environment,
    idempotencyKey,
  });
  return requestPendingPlatformUpgrade({
    prisma: input.prisma,
    gateway: createDefaultPlatformBillingStripeGateway(process.env),
    account,
    planChange: createdPlanChange.record,
    contaId: input.contaId,
    actorUserId: input.actorUserId,
    environment,
    idempotencyKey,
    replayed: createdPlanChange.replayed,
  });
}

export function assertTargetBandCoversCurrentUsage(
  targetPlanCode: PublicPlatformPlanCode,
  activeStudents: number,
  contaId: string,
) {
  const currentUsage = resolveSchoolCommercialTarget(activeStudents);
  const targetRank = getPlatformPlanRank(targetPlanCode);
  const usageRank = currentUsage?.kind === 'SELF_SERVICE'
    ? getPlatformPlanRank(currentUsage.band.code)
    : Number.POSITIVE_INFINITY;
  if (usageRank > targetRank) {
    throw new PlatformBillingError(
      'The selected price band is below the current billable enrollment count.',
      'PLATFORM_BILLING_PLAN_CHANGE_INCOMPATIBLE',
      {
        contaId,
        targetPlanCode,
        activeStudents,
        requiredBand: currentUsage?.kind === 'SELF_SERVICE' ? currentUsage.band.code : 'SPECIALIST',
      },
    );
  }
}

export async function scheduleStablePlatformPriceBandTransition(input: {
  prisma: PrismaClient;
  contaId: string;
  environment: 'TEST' | 'LIVE';
  targetPlanCode: PublicPlatformPlanCode;
}): Promise<'scheduled' | 'already-current' | 'not-eligible' | 'usage-exceeds-band'> {
  const current = await runWithTenant(input.contaId, async (tx) => {
    const [account, snapshots, activeStudents] = await Promise.all([
      tx.platformBillingAccount.findUnique({
        where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment: input.environment } },
      }),
      tx.platformBillingMonthlySnapshot.findMany({
        where: { contaId: input.contaId, environment: input.environment },
        orderBy: { periodStart: 'desc' },
        take: 3,
        select: { periodStart: true, candidateBand: true },
      }),
      countActivePlatformBillingStudents({ tx, contaId: input.contaId }),
    ]);
    return { account, snapshots, activeStudents };
  });
  const { account, snapshots, activeStudents } = current;
  if (!account || !account.planCode || account.planCode === 'CUSTOM'
    // Legacy catalog subscriptions remain reconciliation-only. They need an
    // explicitly contracted transition before the new price bands apply.
    || !isPublicPlatformPlanCode(account.planCode)
    || account.status !== 'ACTIVE' || !account.stripeSubscriptionId
    || !account.currentPeriodEnd || account.currentPeriodEnd <= new Date()
    || account.cancelAtPeriodEnd || account.pendingPlanCode || account.pendingChangeType) {
    return 'not-eligible';
  }
  const stableBand = resolveStableSchoolPriceBand({
    currentBand: isPublicPlatformPlanCode(account.planCode) ? account.planCode : null,
    snapshots,
  });
  if (stableBand !== input.targetPlanCode) return 'not-eligible';
  if (account.planCode === input.targetPlanCode) return 'already-current';
  const currentUsage = resolveSchoolCommercialTarget(activeStudents);
  if (currentUsage?.kind !== 'SELF_SERVICE'
    || getPlatformPlanRank(currentUsage.band.code) > getPlatformPlanRank(input.targetPlanCode)) {
    await upsertDueDowngradeIssue(input.prisma, {
      change: {
        contaId: input.contaId,
        correlationId: null,
      },
      account,
      environment: input.environment,
      code: 'PRICE_BAND_USAGE_EXCEEDS_STABLE_TARGET',
      title: 'A faixa estável não cobre a quantidade atual de alunos',
      message: 'A alteração automática foi adiada porque a faixa atual de uso já exige um valor maior.',
      fingerprint: `${account.id}:${input.targetPlanCode}:usage-exceeds-band`,
      details: { activeStudents, targetPlanCode: input.targetPlanCode },
    });
    return 'usage-exceeds-band';
  }

  const latestClose = snapshots[0]?.periodStart;
  if (!latestClose) return 'not-eligible';
  const idempotencyKey = `auto-band:${latestClose.toISOString().slice(0, 10)}:${input.targetPlanCode}`;
  const environment = input.environment;
  const stripePriceId = resolveStripePriceId({ planCode: input.targetPlanCode, environment, source: process.env });
  const changeType = getPlatformPlanRank(input.targetPlanCode) > getPlatformPlanRank(account.planCode as PlatformPlanCode)
    ? 'UPGRADE'
    : 'DOWNGRADE';
  const created = await createPlatformPlanChangeWithIdempotency(input.prisma, {
    data: {
      contaId: input.contaId,
      billingAccountId: account.id,
      environment,
      type: changeType,
      status: 'PENDING_EFFECTIVE_DATE',
      fromPlanCode: account.planCode as PlatformPlanCode,
      toPlanCode: input.targetPlanCode,
      stripeSubscriptionId: account.stripeSubscriptionId,
      stripePriceId,
      effectiveAt: account.currentPeriodEnd,
      idempotencyKey,
      createdByUserId: null,
      correlationId: idempotencyKey,
      metadata: {
        automaticBandTransition: true,
        sourcePeriodStart: latestClose.toISOString().slice(0, 10),
        activeStudents,
      },
    },
    contaId: input.contaId,
    environment,
    idempotencyKey,
  });
  if (created.record.status !== 'PENDING_EFFECTIVE_DATE') return 'not-eligible';
  await scheduleAndPersistPlanChange({
    prisma: input.prisma,
    stripeGateway: createDefaultPlatformBillingStripeGateway(process.env),
    contaId: input.contaId,
    actorUserId: null,
    environment,
    idempotencyKey,
    account,
    planChange: created.record,
    activeStudents,
    emitAudit: !created.replayed,
  });
  return 'scheduled';
}

export async function requestPlatformSubscriptionCancellation(input: {
  prisma: PrismaClient;
  contaId: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<{ cancelAtPeriodEnd: true; effectiveAt: string | null }> {
  const environment = resolvePlatformBillingEnvironment();
  const idempotencyKey = requirePlatformBillingIdempotencyKey(input.idempotencyKey);
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
    if (existing.type !== 'CANCEL_AT_PERIOD_END') {
      throw new PlatformBillingError(
        'The idempotency key was already used for another platform billing operation.',
        'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT',
        { idempotencyKey, existingOperationType: existing.type },
      );
    }
    if (
      existing.status === 'FAILED' ||
      existing.status === 'CANCELED' ||
      existing.status === 'SUPERSEDED'
    ) {
      throw new PlatformBillingError(
        'The previous cancellation request did not complete. Start a new request to try again.',
        'PLATFORM_BILLING_REPLAY_INVALID',
        { idempotencyKey, planChangeId: existing.id, status: existing.status },
      );
    }
    return {
      cancelAtPeriodEnd: true,
      effectiveAt: existing.effectiveAt?.toISOString() ?? null,
    };
  }
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

  // Repetições da desativação não devem criar novos registros de cancelamento.
  if (account.cancelAtPeriodEnd) {
    // Recover the partial-write case where Stripe and the account mirror were
    // updated but the operation record was not persisted.
    const recovered = await createPlatformPlanChangeWithIdempotency(input.prisma, {
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
        metadata: { recoveredFromAccountState: true },
      },
      contaId: input.contaId,
      environment,
      idempotencyKey,
    });
    if (!recovered.replayed) {
      await auditPlanChange(input.prisma, {
        contaId: input.contaId,
        billingAccountId: account.id,
        actorUserId: input.actorUserId,
        action: 'PLATFORM_BILLING_CANCEL_AT_PERIOD_END_RECOVERED',
        entityId: recovered.record.id,
        correlationId: idempotencyKey,
      });
    }
    return {
      cancelAtPeriodEnd: true,
      effectiveAt: recovered.record.effectiveAt?.toISOString() ?? account.currentPeriodEnd?.toISOString() ?? null,
    };
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
    idempotencyKey: namespaceStripeIdempotencyKey(environment, input.contaId, `${idempotencyKey}:stripe-cancel`),
  });

  await input.prisma.platformBillingAccount.update({
    where: { id: account.id },
    data: {
      cancelAtPeriodEnd: true,
      pendingChangeType: 'CANCEL_AT_PERIOD_END',
      pendingChangeEffectiveAt: account.currentPeriodEnd,
    },
  });

  try {
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
    });
  } catch (error) {
    if (!isPlanChangeIdempotencyViolation(error)) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logApiOperationalEvent({
          severity: 'error',
          eventName: 'api.platform_billing.plan_change.cancel.unique_conflict',
          route: '/api/platform-billing/cancel',
          method: 'SERVICE',
          requestId: crypto.randomUUID(),
          error,
        });
      }
      throw error;
    }

    const concurrent = await input.prisma.platformBillingPlanChange.findUnique({
      where: {
        uq_platform_billing_plan_change_idempotency: {
          contaId: input.contaId,
          environment,
          idempotencyKey,
        },
      },
    });
    if (!concurrent) throw error;
    if (concurrent.type !== 'CANCEL_AT_PERIOD_END') {
      throw new PlatformBillingError(
        'The idempotency key was already used for another platform billing operation.',
        'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT',
        { idempotencyKey, existingOperationType: concurrent.type },
      );
    }
    return {
      cancelAtPeriodEnd: true,
      effectiveAt: concurrent.effectiveAt?.toISOString() ?? null,
    };
  }

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
  idempotencyKey: string;
}): Promise<{ cancelAtPeriodEnd: false }> {
  const environment = resolvePlatformBillingEnvironment();
  const idempotencyKey = requirePlatformBillingIdempotencyKey(input.idempotencyKey);
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
    if (existing.type !== 'UNDO_CANCEL') {
      throw new PlatformBillingError(
        'The idempotency key was already used for another platform billing operation.',
        'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT',
        { idempotencyKey, existingOperationType: existing.type },
      );
    }
    if (existing.status !== 'APPLIED') {
      throw new PlatformBillingError(
        'The previous cancellation reversal did not complete. Start a new request to try again.',
        'PLATFORM_BILLING_REPLAY_INVALID',
        { idempotencyKey, planChangeId: existing.id, status: existing.status },
      );
    }
    return { cancelAtPeriodEnd: false };
  }
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
    idempotencyKey: namespaceStripeIdempotencyKey(environment, input.contaId, `${idempotencyKey}:stripe-undo-cancel`),
  });

  try {
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
      await tx.platformBillingPlanChange.create({
        data: {
          contaId: input.contaId,
          billingAccountId: account.id,
          environment,
          type: 'UNDO_CANCEL',
          status: 'APPLIED',
          fromPlanCode: account.planCode,
          effectiveAt: new Date(),
          stripeSubscriptionId: account.stripeSubscriptionId,
          idempotencyKey,
          createdByUserId: input.actorUserId,
          correlationId: idempotencyKey,
          appliedAt: new Date(),
        },
      });
    });
  } catch (error) {
    if (!isPlanChangeIdempotencyViolation(error)) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logApiOperationalEvent({
          severity: 'error',
          eventName: 'api.platform_billing.plan_change.undo_cancel.unique_conflict',
          route: '/api/platform-billing/cancel',
          method: 'SERVICE',
          requestId: crypto.randomUUID(),
          error,
        });
      }
      throw error;
    }

    const concurrent = await input.prisma.platformBillingPlanChange.findUnique({
      where: {
        uq_platform_billing_plan_change_idempotency: {
          contaId: input.contaId,
          environment,
          idempotencyKey,
        },
      },
    });
    if (!concurrent || concurrent.type !== 'UNDO_CANCEL') throw error;
    return { cancelAtPeriodEnd: false };
  }

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
    if (account.contaId !== change.contaId || account.environment !== change.environment || change.environment !== environment) {
      await markPlanChangeFailed(input.prisma, {
        id: change.id,
        contaId: change.contaId,
        environment: change.environment,
      }, 'Plan change billing account tenant or environment does not match.');
      failed += 1;
      continue;
    }
    const leaseExpiresBefore = new Date(now.getTime() - 5 * 60_000);
    const reservationMatches = Boolean(
      targetPlanCode
      && account.pendingChangeOperationId === change.id
      && account.pendingPlanCode === targetPlanCode
      && account.pendingChangeType === 'DOWNGRADE',
    );
    const hasClaim = account.pendingChangeClaimToken !== null;
    const hasExpiredClaim = Boolean(
      hasClaim
      && account.pendingChangeClaimedAt instanceof Date
      && account.pendingChangeClaimedAt <= leaseExpiresBefore,
    );
    const hasActiveClaim = Boolean(hasClaim && !hasExpiredClaim && account.pendingChangeClaimedAt instanceof Date);
    if (!reservationMatches) {
      const issue = {
        contaId: change.contaId,
        billingAccountId: account.id,
        environment,
        severity: 'WARNING' as const,
        status: 'OPEN' as const,
        code: 'DOWNGRADE_CLAIM_RECONCILIATION_REQUIRED',
        title: 'Reserva de downgrade precisa de reconciliação',
        message: 'A Conta não possui uma reserva local inequívoca para esta alteração pendente.',
        fingerprint: `${change.id}:downgrade-claim-mismatch`,
        details: {
          pendingChangeOperationId: account.pendingChangeOperationId,
          pendingPlanCode: account.pendingPlanCode,
          expectedPlanChangeId: change.id,
        } as Prisma.InputJsonValue,
        correlationId: change.correlationId,
      };
      await input.prisma.platformBillingIssue.upsert({
        where: { uq_platform_billing_issue_env_fingerprint: { environment, fingerprint: issue.fingerprint } },
        create: issue,
        update: {
          contaId: issue.contaId,
          billingAccountId: issue.billingAccountId,
          severity: issue.severity,
          status: issue.status,
          title: issue.title,
          message: issue.message,
          details: issue.details,
          correlationId: issue.correlationId,
          resolvedAt: null,
          ignoredAt: null,
        },
      });
      continue;
    }
    // A live scheduler may still be talking to Stripe. Once its lease expires,
    // replay its operation ID and stable provider idempotency key before
    // reading the subscription or attempting the local application.
    if (hasActiveClaim) continue;
    if (hasClaim && !hasExpiredClaim) {
      await input.prisma.platformBillingIssue.upsert({
        where: {
          uq_platform_billing_issue_env_fingerprint: {
            environment,
            fingerprint: `${change.id}:downgrade-claim-lease-invalid`,
          },
        },
        create: {
          contaId: change.contaId,
          billingAccountId: account.id,
          environment,
          severity: 'WARNING',
          status: 'OPEN',
          code: 'DOWNGRADE_CLAIM_LEASE_INVALID',
          title: 'Lease de downgrade inválido',
          message: 'A reserva possui token sem timestamp; reconciliação manual é necessária.',
          fingerprint: `${change.id}:downgrade-claim-lease-invalid`,
          correlationId: change.correlationId,
        },
        update: { status: 'OPEN', resolvedAt: null, ignoredAt: null },
      });
      continue;
    }
    if (!targetPlanCode || !account.stripeSubscriptionId) {
      await markPlanChangeFailed(
        input.prisma,
        { id: change.id, contaId: change.contaId, environment: change.environment },
        'Plan change missing target plan or Stripe subscription.',
      );
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
    const storedScheduleId = readMetadataObject(change.metadata).stripeScheduleId;
    let scheduleId: string | null = typeof storedScheduleId === 'string' ? storedScheduleId : null;
    const stripePriceId = resolveStripePriceId({
      planCode: targetPlanCode,
      environment,
      source: process.env,
    });
    // Check canonical provider state before replaying an expired schedule claim. A completed
    // schedule may already have detached, and replaying its old effectiveAt can fail forever.
    const stripeSubscription = await gateway.retrieveSubscription(account.stripeSubscriptionId);
    if (hasExpiredClaim && stripeSubscription.priceId !== stripePriceId) {
      try {
        const recovered = await scheduleAndPersistPlanChange({
          prisma: input.prisma,
          stripeGateway: gateway,
          contaId: change.contaId,
          actorUserId: 'system:platform-billing-maintenance',
          environment,
          idempotencyKey: change.correlationId ?? change.id,
          account,
          planChange: change,
          activeStudents,
          emitAudit: false,
        });
        scheduleId = recovered.scheduleId;
      } catch (error) {
        await upsertDueDowngradeIssue(input.prisma, {
          change,
          account,
          environment,
          code: 'DOWNGRADE_SCHEDULE_RECOVERY_FAILED',
          title: 'Recuperação do schedule de downgrade falhou',
          message: error instanceof Error ? error.message : 'Falha desconhecida ao recuperar schedule Stripe.',
          fingerprint: `${change.id}:downgrade-schedule-recovery-failed`,
        });
        continue;
      }
    }
    if (stripeSubscription.priceId !== stripePriceId) {
      if (capacity.allowed) {
        await upsertDueDowngradeIssue(input.prisma, {
          change,
          account,
          environment,
          code: 'DOWNGRADE_SCHEDULE_NOT_APPLIED',
          title: 'Stripe ainda não aplicou o downgrade agendado',
          message: 'A alteração permanece pendente enquanto a assinatura Stripe não refletir o Price de destino.',
          fingerprint: `${change.id}:downgrade-schedule-not-applied`,
        });
        continue;
      }

      if (!scheduleId) {
        await upsertDueDowngradeIssue(input.prisma, {
          change,
          account,
          environment,
          code: 'DOWNGRADE_RELEASE_RECONCILIATION_REQUIRED',
          title: 'Não foi possível localizar o schedule para cancelar o downgrade',
          message: 'A Conta excede a capacidade do plano de destino e o schedule Stripe não está registrado localmente.',
          fingerprint: `${change.id}:downgrade-release-schedule-missing`,
          details: { ...capacity },
        });
        continue;
      }

      try {
        await gateway.releaseSubscriptionSchedule({
          scheduleId,
          idempotencyKey: namespaceStripeIdempotencyKey(
            environment,
            change.contaId,
            `plan-change:${change.id}:stripe-downgrade-release`,
          ),
        });
      } catch (error) {
        await upsertDueDowngradeIssue(input.prisma, {
          change,
          account,
          environment,
          code: 'DOWNGRADE_RELEASE_RECONCILIATION_REQUIRED',
          title: 'Não foi possível cancelar o downgrade no Stripe',
          message: error instanceof Error ? error.message : 'Falha desconhecida ao liberar schedule Stripe.',
          fingerprint: `${change.id}:downgrade-release-failed`,
          details: { scheduleId, ...capacity },
        });
        continue;
      }

      const released = await input.prisma.$transaction(async (tx) => {
        const accountCleared = await tx.platformBillingAccount.updateMany({
          where: {
            id: account.id,
            contaId: change.contaId,
            environment: change.environment,
            stripeSubscriptionId: change.stripeSubscriptionId,
            pendingPlanCode: targetPlanCode,
            pendingChangeOperationId: change.id,
            pendingChangeType: 'DOWNGRADE',
            pendingChangeClaimToken: null,
          },
          data: {
            pendingPlanCode: null,
            pendingChangeType: null,
            pendingChangeEffectiveAt: null,
            pendingChangeOperationId: null,
            pendingChangeClaimToken: null,
            pendingChangeClaimedAt: null,
          },
        });
        if (accountCleared.count !== 1) return false;
        const changeFailed = await tx.platformBillingPlanChange.updateMany({
          where: {
            id: change.id,
            contaId: change.contaId,
            billingAccountId: account.id,
            environment: change.environment,
            status: 'PENDING_EFFECTIVE_DATE',
          },
          data: {
            status: 'FAILED',
            failedAt: now,
            lastError: 'Downgrade schedule released because the account exceeds target plan capacity.',
          },
        });
        if (changeFailed.count !== 1) throw new Error('Released downgrade could not be finalized locally.');
        return true;
      });
      if (!released) {
        await upsertDueDowngradeIssue(input.prisma, {
          change,
          account,
          environment,
          code: 'DOWNGRADE_RELEASE_RECONCILIATION_REQUIRED',
          title: 'Schedule liberado, mas estado local precisa de reconciliação',
          message: 'Stripe confirmou a liberação, mas a reserva local mudou antes da atualização.',
          fingerprint: `${change.id}:downgrade-release-local-cas-lost`,
          details: { scheduleId, ...capacity },
        });
        continue;
      }

      await upsertDueDowngradeIssue(input.prisma, {
        change,
        account,
        environment,
        code: 'DOWNGRADE_NOT_ELIGIBLE',
        title: 'Alteração de plano perdeu elegibilidade',
        message: 'O schedule foi liberado no Stripe porque a Conta excede a capacidade do plano escolhido.',
        fingerprint: `${change.id}:downgrade-not-eligible`,
        details: { scheduleId, ...capacity },
      });
      failed += 1;
      continue;
    }
    if (!capacity.allowed) {
      await upsertDueDowngradeIssue(input.prisma, {
        change,
        account,
        environment,
        code: 'DOWNGRADE_CAPACITY_EXCEEDED_AFTER_SCHEDULE',
        title: 'A assinatura mudou para um plano abaixo da capacidade atual',
        message: 'Stripe já aplicou o downgrade; a Conta foi atualizada para refletir o estado real da assinatura.',
        fingerprint: `${change.id}:downgrade-capacity-exceeded-after-schedule`,
        details: { ...capacity },
      });
    }
    const applied = await input.prisma.$transaction(async (tx) => {
      const accountUpdated = await tx.platformBillingAccount.updateMany({
        where: {
          id: account.id,
          contaId: change.contaId,
          environment: change.environment,
          stripeSubscriptionId: change.stripeSubscriptionId,
          pendingPlanCode: targetPlanCode,
          pendingChangeOperationId: change.id,
          pendingChangeType: 'DOWNGRADE',
          OR: [
            { pendingChangeClaimToken: null },
            ...(hasExpiredClaim ? [{
              pendingChangeClaimToken: account.pendingChangeClaimToken,
              pendingChangeClaimedAt: {
                equals: account.pendingChangeClaimedAt,
                lte: leaseExpiresBefore,
              },
            }] : []),
          ],
        },
        data: {
          planCode: targetPlanCode,
          stripePriceId,
          pendingPlanCode: null,
          pendingChangeType: null,
          pendingChangeEffectiveAt: null,
          pendingChangeOperationId: null,
          pendingChangeClaimToken: null,
          pendingChangeClaimedAt: null,
        },
      });
      if (accountUpdated.count !== 1) return false;

      const changeUpdated = await tx.platformBillingPlanChange.updateMany({
        where: {
          id: change.id,
          contaId: change.contaId,
          billingAccountId: account.id,
          environment: change.environment,
          status: 'PENDING_EFFECTIVE_DATE',
        },
        data: {
          status: 'APPLIED',
          stripePriceId,
          appliedAt: now,
          metadata: { activeStudents, verifiedStripePriceId: stripeSubscription.priceId } as Prisma.InputJsonValue,
        },
      });
      if (changeUpdated.count !== 1) throw new Error('Plan change was no longer pending during atomic downgrade application.');
      return true;
    });
    if (!applied) continue;

    submitted += 1;
  }

  return {
    checked: dueChanges.length,
    submitted,
    failed,
  };
}

async function upsertDueDowngradeIssue(
  prisma: PrismaClient,
  input: {
    change: { contaId: string; correlationId: string | null };
    account: { id: string };
    environment: 'TEST' | 'LIVE';
    code: string;
    title: string;
    message: string;
    fingerprint: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const issue = {
    contaId: input.change.contaId,
    billingAccountId: input.account.id,
    environment: input.environment,
    severity: 'WARNING' as const,
    status: 'OPEN' as const,
    code: input.code,
    title: input.title,
    message: input.message,
    fingerprint: input.fingerprint,
    details: input.details as Prisma.InputJsonValue | undefined,
    correlationId: input.change.correlationId ?? undefined,
  };
  await prisma.platformBillingIssue.upsert({
    where: {
      uq_platform_billing_issue_env_fingerprint: {
        environment: input.environment,
        fingerprint: input.fingerprint,
      },
    },
    create: issue,
    update: {
      contaId: issue.contaId,
      billingAccountId: issue.billingAccountId,
      severity: issue.severity,
      status: issue.status,
      title: issue.title,
      message: issue.message,
      details: issue.details,
      correlationId: issue.correlationId,
      resolvedAt: null,
      ignoredAt: null,
    },
  });
}

async function markPlanChangeFailed(
  prisma: PrismaClient,
  identity: { id: string; contaId: string; environment: 'TEST' | 'LIVE' },
  message: string,
): Promise<void> {
  await prisma.platformBillingPlanChange.updateMany({
    where: {
      id: identity.id,
      contaId: identity.contaId,
      environment: identity.environment,
      status: { in: ['PENDING_EFFECTIVE_DATE', 'PENDING_PAYMENT'] },
    },
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      lastError: message,
    },
  });
}

async function requestPendingPlatformUpgrade(input: {
  prisma: PrismaClient;
  gateway: ReturnType<typeof createDefaultPlatformBillingStripeGateway>;
  account: {
    id: string;
    contaId: string;
    environment: 'TEST' | 'LIVE';
    planCode: string | null;
    stripeSubscriptionId: string | null;
    pendingPlanCode: string | null;
    pendingChangeType: string | null;
    pendingChangeOperationId: string | null;
  };
  planChange: PlatformPlanChangeReplayRecord;
  contaId: string;
  actorUserId: string;
  environment: 'TEST' | 'LIVE';
  idempotencyKey: string;
  replayed: boolean;
}): Promise<PlatformPlanChangeResponse> {
  const { account, planChange } = input;
  if (
    planChange.type !== 'UPGRADE'
    || planChange.status !== 'PENDING_PAYMENT'
    || !planChange.fromPlanCode
    || !planChange.toPlanCode
    || !planChange.stripeSubscriptionId
    || !planChange.stripePriceId
    || account.planCode !== planChange.fromPlanCode
    || account.stripeSubscriptionId !== planChange.stripeSubscriptionId
  ) {
    throw new PlatformBillingError('Stored upgrade cannot be safely scheduled or recovered.', 'PLATFORM_BILLING_REPLAY_INVALID', { planChangeId: planChange.id });
  }
  const fromPlanCode = planChange.fromPlanCode as PlatformPlanCode;
  const toPlanCode = planChange.toPlanCode as PublicPlatformPlanCode;
  const alreadyReserved = account.pendingChangeType === 'UPGRADE'
    && account.pendingPlanCode === planChange.toPlanCode
    && account.pendingChangeOperationId === planChange.id;
  if (account.pendingChangeOperationId && account.pendingChangeOperationId !== planChange.id) {
    throw new PlatformBillingError('Another plan change currently owns the account reservation.', 'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS', { contaId: input.contaId, planChangeId: planChange.id });
  }

  let preview: Awaited<ReturnType<typeof input.gateway.previewSubscriptionPlanChange>> | null = null;
  if (!alreadyReserved) {
    try {
      preview = await input.gateway.previewSubscriptionPlanChange({
        subscriptionId: planChange.stripeSubscriptionId,
        priceId: planChange.stripePriceId,
        idempotencyKey: namespaceStripeIdempotencyKey(input.environment, input.contaId, `plan-change:${planChange.id}:preview`),
      });
    } catch (error) {
      await markPlanChangeFailed(input.prisma, {
        id: planChange.id, contaId: input.contaId, environment: input.environment,
      }, error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000));
      throw error;
    }

    const reserved = await input.prisma.platformBillingAccount.updateMany({
      where: {
        id: account.id,
        contaId: input.contaId,
        environment: input.environment,
        stripeSubscriptionId: planChange.stripeSubscriptionId,
        planCode: fromPlanCode,
        OR: [
          { pendingPlanCode: null, pendingChangeType: null, pendingChangeOperationId: null },
          {
            pendingPlanCode: toPlanCode,
            pendingChangeType: 'UPGRADE',
            pendingChangeOperationId: planChange.id,
            pendingChangeClaimToken: null,
          },
        ],
      },
      data: {
        pendingPlanCode: toPlanCode,
        pendingChangeType: 'UPGRADE',
        pendingChangeEffectiveAt: null,
        pendingChangeOperationId: planChange.id,
        pendingChangeClaimToken: null,
        pendingChangeClaimedAt: null,
      },
    });
    if (reserved.count !== 1) {
      await input.prisma.platformBillingPlanChange.updateMany({
        where: {
          id: planChange.id,
          contaId: input.contaId,
          environment: input.environment,
          status: 'PENDING_PAYMENT',
        },
        data: {
          status: 'SUPERSEDED',
          lastError: 'Another plan-change operation owns the account reservation.',
        },
      });
      throw new PlatformBillingError('Another plan change currently owns the account reservation.', 'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS', { contaId: input.contaId, planChangeId: planChange.id });
    }
  }

  let updatedSubscription: Awaited<ReturnType<typeof input.gateway.updateSubscriptionPlan>>;
  try {
    updatedSubscription = await input.gateway.updateSubscriptionPlan({
      subscriptionId: planChange.stripeSubscriptionId,
      priceId: planChange.stripePriceId,
      paymentBehavior: 'pending_if_incomplete',
      prorationBehavior: 'always_invoice',
      metadata: {
        contaId: input.contaId,
        planCode: planChange.toPlanCode,
        billingContext: 'platform',
        planChangeId: planChange.id,
      },
      idempotencyKey: namespaceStripeIdempotencyKey(input.environment, input.contaId, `plan-change:${planChange.id}:stripe-upgrade`),
    });
  } catch (error) {
    if (isDefinitiveStripeNoEffect(error)) {
      await input.prisma.platformBillingAccount.updateMany({
        where: {
          id: account.id,
          contaId: input.contaId,
          environment: input.environment,
          pendingPlanCode: toPlanCode,
          pendingChangeType: 'UPGRADE',
          pendingChangeOperationId: planChange.id,
          pendingChangeClaimToken: null,
        },
        data: {
          pendingPlanCode: null,
          pendingChangeType: null,
          pendingChangeEffectiveAt: null,
          pendingChangeOperationId: null,
          pendingChangeClaimToken: null,
          pendingChangeClaimedAt: null,
        },
      });
      await markPlanChangeFailed(input.prisma, {
        id: planChange.id, contaId: input.contaId, environment: input.environment,
      }, error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000));
    }
    // Timeouts, transport failures, and server errors are ambiguous: retain
    // PENDING_PAYMENT and the operation reservation for same-key recovery.
    throw error;
  }

  const previewMetadata = preview
    ? {
        amountDue: preview.amountDue,
        amountRemaining: preview.amountRemaining,
        currency: preview.currency,
        nextPaymentAttempt: preview.nextPaymentAttempt?.toISOString() ?? null,
      }
    : readMetadataObject(planChange.metadata).preview as Record<string, unknown> | undefined;
  await input.prisma.platformBillingPlanChange.update({
    where: { id: planChange.id, contaId: input.contaId, environment: input.environment },
    data: {
      stripePendingUpdateId: updatedSubscription.pendingUpdateId,
      metadata: {
        ...readMetadataObject(planChange.metadata),
        ...(previewMetadata ? { preview: previewMetadata } : {}),
        stripeSubscriptionStatus: updatedSubscription.status,
      } as Prisma.InputJsonValue,
    },
  });

  if (!input.replayed) {
    await auditPlanChange(input.prisma, {
      contaId: input.contaId,
      billingAccountId: account.id,
      actorUserId: input.actorUserId,
      action: 'PLATFORM_BILLING_UPGRADE_REQUESTED',
      entityId: planChange.id,
      correlationId: input.idempotencyKey,
      metadata: { fromPlanCode: account.planCode, toPlanCode: planChange.toPlanCode, preview: previewMetadata },
    });
  } else {
    const audit = await input.prisma.platformBillingAuditLog.findFirst({
      where: {
        contaId: input.contaId,
        entityType: 'PlatformBillingPlanChange',
        entityId: planChange.id,
        action: 'PLATFORM_BILLING_UPGRADE_REQUESTED',
      },
      select: { id: true },
    });
    if (!audit) {
      await auditPlanChange(input.prisma, {
        contaId: input.contaId,
        billingAccountId: account.id,
        actorUserId: input.actorUserId,
        action: 'PLATFORM_BILLING_UPGRADE_REQUESTED',
        entityId: planChange.id,
        correlationId: input.idempotencyKey,
        metadata: { fromPlanCode: account.planCode, toPlanCode: planChange.toPlanCode, preview: previewMetadata },
      });
    }
  }

  const responsePreview = previewMetadata as { amountDue?: unknown; amountRemaining?: unknown; currency?: unknown } | undefined;
  return {
    planChangeId: planChange.id,
    type: 'UPGRADE',
    status: 'PENDING_PAYMENT',
    effectiveAt: null,
    message: 'Plano alterado com sucesso.',
    detail: 'A alteração será concluída após a confirmação do pagamento.',
    ...(typeof responsePreview?.amountDue === 'number'
      && typeof responsePreview.amountRemaining === 'number'
      && typeof responsePreview.currency === 'string'
      ? { preview: { amountDue: responsePreview.amountDue, amountRemaining: responsePreview.amountRemaining, currency: responsePreview.currency } }
      : {}),
  };
}

function isDefinitiveStripeNoEffect(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { type?: unknown; statusCode?: unknown };
  return candidate.type === 'StripeInvalidRequestError' && candidate.statusCode === 400;
}

async function scheduleAndPersistPlanChange(input: {
  prisma: PrismaClient;
  stripeGateway: ReturnType<typeof createDefaultPlatformBillingStripeGateway>;
  contaId: string;
  actorUserId: string | null;
  environment: 'TEST' | 'LIVE';
  idempotencyKey: string;
  account: {
    id: string;
    planCode: string | null;
    stripeSubscriptionId: string | null;
    pendingPlanCode: string | null;
    pendingChangeOperationId: string | null;
  };
  planChange: {
    id: string;
    type: string;
    status: string;
    fromPlanCode: string | null;
    toPlanCode: string | null;
    stripeSubscriptionId: string | null;
    stripePriceId: string | null;
    effectiveAt: Date | null;
    metadata: Prisma.JsonValue;
  };
  activeStudents: number;
  emitAudit: boolean;
}): Promise<{ scheduleId: string; effectiveAt: Date }> {
  const { account, planChange } = input;
  if (
    (planChange.type !== 'DOWNGRADE' && planChange.type !== 'UPGRADE')
    || planChange.status !== 'PENDING_EFFECTIVE_DATE'
    || !planChange.fromPlanCode
    || !planChange.toPlanCode
    || !planChange.stripeSubscriptionId
    || !planChange.stripePriceId
    || !planChange.effectiveAt
    || !account.planCode
    || !account.stripeSubscriptionId
  ) {
    throw new PlatformBillingError('Stored plan change cannot be safely scheduled or recovered.', 'PLATFORM_BILLING_REPLAY_INVALID', { planChangeId: planChange.id });
  }
  const result = await schedulePlatformBillingDowngrade({
    contaId: input.contaId,
    billingAccountId: account.id,
    actorUserId: input.actorUserId,
    environment: input.environment,
    idempotencyKey: input.idempotencyKey,
      changeType: planChange.type,
      idempotencySuffix: planChange.type === 'DOWNGRADE' ? 'stripe-downgrade' : 'stripe-band-transition',
    planChange: {
      id: planChange.id,
      fromPlanCode: planChange.fromPlanCode as PlatformPlanCode,
      toPlanCode: planChange.toPlanCode as PublicPlatformPlanCode,
      stripeSubscriptionId: planChange.stripeSubscriptionId,
      stripePriceId: planChange.stripePriceId,
      effectiveAt: planChange.effectiveAt,
    },
    account: {
      planCode: account.planCode as PlatformPlanCode,
      stripeSubscriptionId: account.stripeSubscriptionId,
      pendingPlanCode: account.pendingPlanCode as PlatformPlanCode | null,
      pendingChangeOperationId: account.pendingChangeOperationId,
    },
    activeStudents: input.activeStudents,
  }, {
    stripeGateway: input.stripeGateway,
    store: {
      async reservePendingPlan(update) {
        const changed = await input.prisma.platformBillingAccount.updateMany({
          where: {
            id: update.billingAccountId,
            contaId: update.contaId,
            environment: update.environment,
            stripeSubscriptionId: update.stripeSubscriptionId,
            planCode: update.fromPlanCode,
            OR: [
              { pendingPlanCode: null, pendingChangeType: null, pendingChangeOperationId: null },
              {
                pendingPlanCode: update.toPlanCode,
                pendingChangeType: update.changeType,
                pendingChangeOperationId: update.operationId,
                OR: [
                  { pendingChangeClaimToken: null },
                  { pendingChangeClaimedAt: { lt: update.claimExpiresBefore } },
                ],
              },
            ],
          },
          data: {
            pendingPlanCode: update.toPlanCode,
            pendingChangeType: update.changeType,
            pendingChangeEffectiveAt: update.effectiveAt,
            pendingChangeOperationId: update.operationId,
            pendingChangeClaimToken: update.claimToken,
            pendingChangeClaimedAt: update.claimAt,
          },
        });
        return changed.count === 1;
      },
      async releasePendingPlanClaim(claim) {
        await input.prisma.platformBillingAccount.updateMany({
          where: {
            id: claim.billingAccountId,
            contaId: input.contaId,
            environment: input.environment,
            pendingChangeOperationId: claim.operationId,
            pendingChangeClaimToken: claim.claimToken,
          },
          data: {
            pendingPlanCode: null,
            pendingChangeType: null,
            pendingChangeEffectiveAt: null,
            pendingChangeOperationId: null,
            pendingChangeClaimToken: null,
            pendingChangeClaimedAt: null,
          },
        });
      },
      async completePendingPlanClaim(claim) {
        const completed = await input.prisma.platformBillingAccount.updateMany({
          where: {
            id: claim.billingAccountId,
            contaId: input.contaId,
            environment: input.environment,
            pendingChangeOperationId: claim.operationId,
            pendingChangeClaimToken: claim.claimToken,
          },
          data: {
            pendingChangeEffectiveAt: claim.effectiveAt,
            pendingChangeClaimToken: null,
            pendingChangeClaimedAt: null,
          },
        });
        return completed.count === 1;
      },
      async persistSchedule(persist) {
        return input.prisma.$transaction(async (tx) => {
          const stillOwned = await tx.platformBillingAccount.updateMany({
            where: {
              id: account.id,
              contaId: input.contaId,
              environment: input.environment,
              pendingChangeOperationId: planChange.id,
              pendingChangeClaimToken: persist.claimToken,
            },
            // Touching the row acquires its write lock before persisting the
            // schedule, fencing a stale worker whose lease was reclaimed.
            data: { pendingChangeClaimToken: persist.claimToken },
          });
          if (stillOwned.count !== 1) return false;
          await tx.platformBillingPlanChange.update({
            where: { id: persist.planChangeId, contaId: input.contaId, environment: input.environment },
            data: {
              metadata: {
                ...readMetadataObject(planChange.metadata),
                activeStudents: persist.activeStudents,
                stripeScheduleId: persist.scheduleId,
              } as Prisma.InputJsonValue,
            },
          });
          return true;
        });
      },
      async createAuditLog(audit) {
        if (!input.emitAudit) return;
        await input.prisma.platformBillingAuditLog.create({
          data: {
            contaId: audit.contaId,
            billingAccountId: audit.billingAccountId,
            actorUserId: audit.actorUserId,
            action: audit.action,
            entityType: audit.entityType,
            entityId: audit.entityId,
            correlationId: audit.correlationId,
            metadata: audit.metadata as Prisma.InputJsonValue | undefined,
          },
        });
      },
    },
  });
  return result;
}

function readActiveStudents(metadata: Prisma.JsonValue): number {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 0;
  const value = (metadata as { activeStudents?: unknown }).activeStudents;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readMetadataObject(metadata: Prisma.JsonValue): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

async function createPlatformPlanChangeWithIdempotency(
  prisma: PrismaClient,
  input: {
    data: Prisma.PlatformBillingPlanChangeUncheckedCreateInput;
    contaId: string;
    environment: 'TEST' | 'LIVE';
    idempotencyKey: string;
  },
): Promise<{
  record: PlatformPlanChangeReplayRecord;
  replayed: boolean;
}> {
  try {
    const record = await prisma.platformBillingPlanChange.create({ data: input.data });
    return { record, replayed: false };
  } catch (error) {
    if (!isPlanChangeIdempotencyViolation(error)) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logApiOperationalEvent({
          severity: 'error',
          eventName: 'api.platform_billing.plan_change.request.unique_conflict',
          route: '/api/platform-billing/plan-change',
          method: 'SERVICE',
          requestId: crypto.randomUUID(),
          error,
        });
      }
      throw error;
    }

    const concurrent = await prisma.platformBillingPlanChange.findUnique({
      where: {
        uq_platform_billing_plan_change_idempotency: {
          contaId: input.contaId,
          environment: input.environment,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (!concurrent) throw error;
    return { record: concurrent, replayed: true };
  }
}

function replayPlatformPlanChange(
  existing: PlatformPlanChangeReplayRecord,
  targetPlanCode: PublicPlatformPlanCode,
  idempotencyKey: string,
): PlatformPlanChangeResponse {
  if (existing.toPlanCode !== targetPlanCode) {
    throw new PlatformBillingError(
      'The idempotency key was already used for another target plan.',
      'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT',
      { idempotencyKey, existingPlanCode: existing.toPlanCode, requestedPlanCode: targetPlanCode },
    );
  }
  if (
    existing.status === 'FAILED' ||
    existing.status === 'CANCELED' ||
    existing.status === 'SUPERSEDED'
  ) {
    throw new PlatformBillingError(
      'The previous plan change did not complete. Start a new request to try again.',
      'PLATFORM_BILLING_REPLAY_INVALID',
      { idempotencyKey, planChangeId: existing.id, status: existing.status },
    );
  }
  return {
    planChangeId: existing.id,
    type: existing.type as 'UPGRADE' | 'DOWNGRADE',
    status: existing.status as 'PENDING_PAYMENT' | 'PENDING_EFFECTIVE_DATE' | 'APPLIED',
    effectiveAt: existing.effectiveAt?.toISOString() ?? null,
    message: getPlanChangeSuccessMessage(existing.status),
    detail: getPlanChangeDetail(
      existing.status,
      existing.effectiveAt,
      accountTrialEndsAt(existing.metadata),
    ),
  };
}

function requirePlatformBillingIdempotencyKey(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new PlatformBillingError(
      'A platform billing idempotency key is required.',
      'PLATFORM_BILLING_IDEMPOTENCY_REQUIRED',
    );
  }
  if (normalized.length > 128) {
    throw new PlatformBillingError(
      'Platform billing idempotency keys must be 128 characters or fewer.',
      'PLATFORM_BILLING_INPUT_INVALID',
    );
  }
  return normalized;
}

function isPlanChangeIdempotencyViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return false;
  const target = error.meta?.target;
  return Array.isArray(target) && target.some((field) => field === 'idempotencyKey');
}

function getPlanChangeSuccessMessage(status: string): string {
  if (status === 'APPLIED' || status === 'PENDING_EFFECTIVE_DATE')
    return 'Plano alterado com sucesso.';
  return 'Plano alterado com sucesso.';
}

function getPlanChangeDetail(
  status: string,
  effectiveAt: Date | null,
  trialEndsAt: Date | null,
): string | null {
  if (status === 'APPLIED' && trialEndsAt) {
    return `Seu teste gratuito continua até ${formatDatePtBr(trialEndsAt)}.`;
  }
  if (status === 'PENDING_EFFECTIVE_DATE') {
    return effectiveAt
      ? `A mudança entra em vigor em ${formatDatePtBr(effectiveAt)}.`
      : 'A mudança entra em vigor no próximo ciclo.';
  }
  if (status === 'PENDING_PAYMENT')
    return 'A alteração será concluída após a confirmação do pagamento.';
  return null;
}

function accountTrialEndsAt(metadata: Prisma.JsonValue): Date | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as { trialEndsAt?: unknown }).trialEndsAt;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDatePtBr(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
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
    where: { contaId, status: 'ATIVA', aluno: { status: 'ATIVO' } },
    distinct: ['alunoId'],
    select: { alunoId: true },
  });
  return rows.length;
}

async function countCurrentBillableStudents(contaId: string): Promise<number> {
  return runWithTenant(contaId, (tx) => countActivePlatformBillingStudents({ tx, contaId }));
}

function namespaceStripeIdempotencyKey(environment: 'TEST' | 'LIVE', contaId: string, key: string): string {
  const namespacedKey = `alusa:${environment}:${contaId}:${key}`;
  if (namespacedKey.length > 255) {
    throw new PlatformBillingError('Stripe idempotency key exceeds the provider limit.', 'PLATFORM_BILLING_INPUT_INVALID');
  }
  return namespacedKey;
}
