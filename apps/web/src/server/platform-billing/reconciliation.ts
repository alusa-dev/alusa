import { Prisma, type PrismaClient } from '@prisma/client';
import {
  computeGracePeriodEnd,
  createDefaultPlatformBillingStripeGateway,
  derivePlatformAccessStatus,
  derivePlatformRestrictionReason,
  resolvePlanCodeFromStripePriceId,
  type PlatformBillingAccessStatus,
  type PlatformBillingAccountStatus,
  type PlatformBillingEnvironment,
  type PlatformPlanCode,
} from '@alusa/platform-billing';
import { getStripeClient, retrieveStripeDefaultPaymentMethod, type StripeSubscriptionRecord } from '@alusa/stripe';
import { resolvePlatformBillingEnvironment } from './platform-billing-server';

type ReconciliationAccount = {
  id: string;
  contaId: string;
  status: PlatformBillingAccountStatus;
  accessStatus: PlatformBillingAccessStatus;
  planCode: PlatformPlanCode | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
  gracePeriodEndsAt: Date | null;
  restrictedAt: Date | null;
  lastPaymentFailedAt: Date | null;
  firstPaidAt: Date | null;
  lastSuccessfulPaymentAt: Date | null;
  paymentMethodStatus: 'MISSING' | 'PRESENT' | 'UNKNOWN';
  paymentMethodType: string | null;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  paymentMethodExpMonth: number | null;
  paymentMethodExpYear: number | null;
  restrictionReason: string | null;
  gracePeriodStartedAt: Date | null;
  accessStateVersion: number;
  pendingPlanCode: PlatformPlanCode | null;
  pendingChangeType: string | null;
  pendingChangeEffectiveAt: Date | null;
  lastReconciledAt: Date | null;
};

type ReconciliationIssueInput = {
  contaId: string;
  billingAccountId?: string;
  environment: PlatformBillingEnvironment;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  code: string;
  title: string;
  message: string;
  fingerprint: string;
  details?: Record<string, unknown>;
  correlationId?: string;
};

export async function reconcilePlatformBilling(input: {
  prisma: PrismaClient;
  contaId?: string;
  limit?: number;
  environment?: PlatformBillingEnvironment;
}): Promise<{ checkedAccounts: number; issues: number }> {
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const accounts = await input.prisma.platformBillingAccount.findMany({
    where: {
      environment,
      ...(input.contaId ? { contaId: input.contaId } : {}),
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });

  const gateway = createDefaultPlatformBillingStripeGateway(process.env);
  let issues = 0;

  for (const account of accounts) {
    if (!account.stripeCustomerId) {
      await upsertIssue(input.prisma, {
        contaId: account.contaId,
        billingAccountId: account.id,
        environment,
        severity: 'WARNING',
        code: 'CUSTOMER_LOCAL_MISSING_STRIPE_ID',
        title: 'Customer Stripe ausente na Alusa',
        message: 'A conta de billing local não possui stripeCustomerId.',
        fingerprint: `${account.id}:customer-missing`,
      });
      issues += 1;
    }

    if (!account.stripeSubscriptionId) {
      if (account.status === 'ACTIVE' || account.accessStatus === 'ACTIVE') {
        await upsertIssue(input.prisma, {
          contaId: account.contaId,
          billingAccountId: account.id,
          environment,
          severity: 'CRITICAL',
          code: 'ACTIVE_LOCAL_WITHOUT_SUBSCRIPTION',
          title: 'Conta ativa sem assinatura Stripe',
          message: 'A Alusa indica acesso ativo, mas não há stripeSubscriptionId local.',
          fingerprint: `${account.id}:active-without-subscription`,
        });
        issues += 1;
      }
      continue;
    }

    try {
      const subscription = await gateway.retrieveSubscription(account.stripeSubscriptionId);
      const paymentMethod = await resolvePaymentMethod(account, subscription.customerId);
      if (subscription.priceId && account.stripePriceId && subscription.priceId !== account.stripePriceId) {
        await upsertIssue(input.prisma, {
          contaId: account.contaId,
          billingAccountId: account.id,
          environment,
          severity: 'WARNING',
          code: 'SUBSCRIPTION_PRICE_DIVERGENT',
          title: 'Price local divergente do Stripe',
          message: 'A assinatura Stripe está em um Price diferente do registro local.',
          fingerprint: `${account.id}:price-divergent`,
          details: {
            localPlanCode: account.planCode,
            stripeSubscriptionStatus: subscription.status,
          },
        });
        issues += 1;
      }

      let resolvedPlanCode: 'STARTER' | 'PREMIUM' | 'PRO' | 'CUSTOM' | null = null;
      if (subscription.priceId) {
        try {
          const resolved = resolvePlanCodeFromStripePriceId(subscription.priceId, {
            ...process.env,
            STRIPE_ENVIRONMENT: environment,
          });
          resolvedPlanCode = resolved.planCode;
          if (account.planCode && resolved.planCode !== account.planCode) {
            await upsertIssue(input.prisma, {
              contaId: account.contaId,
              billingAccountId: account.id,
              environment,
              severity: 'WARNING',
              code: 'PLAN_DIVERGENT_FROM_STRIPE_PRICE',
              title: 'Plano local divergente do Price Stripe',
              message: 'O plano local não corresponde ao Price ativo da assinatura Stripe.',
              fingerprint: `${account.id}:plan-price-divergent`,
              details: {
                localPlanCode: account.planCode,
                stripePlanCode: resolved.planCode,
              },
            });
            issues += 1;
          }
        } catch {
          await upsertIssue(input.prisma, {
            contaId: account.contaId,
            billingAccountId: account.id,
            environment,
            severity: 'CRITICAL',
            code: 'UNKNOWN_STRIPE_PRICE',
            title: 'Price Stripe desconhecido',
            message: 'A assinatura Stripe usa um Price que não está mapeado no servidor.',
            fingerprint: `${account.id}:unknown-price`,
          });
          issues += 1;
        }
      }

      if (resolvedPlanCode) {
        const corrected = await correctAccountFromStripeSubscription(input.prisma, {
          account,
          subscription,
          planCode: resolvedPlanCode,
          environment,
          paymentMethod,
        });
        if (corrected) {
          console.info('[platform-billing][reconciliation]', {
            event: 'account_corrected_from_stripe',
            contaId: account.contaId,
            accountId: account.id,
            subscriptionId: subscription.id,
          });
        }
      }

      if (account.accessStatus === 'ACTIVE' && subscription.status === 'canceled') {
        await upsertIssue(input.prisma, {
          contaId: account.contaId,
          billingAccountId: account.id,
          environment,
          severity: 'CRITICAL',
          code: 'ACTIVE_LOCAL_CANCELED_ON_STRIPE',
          title: 'Conta ativa com assinatura cancelada na Stripe',
          message: 'Acesso local está ativo, mas Stripe retornou assinatura cancelada.',
          fingerprint: `${account.id}:active-canceled-stripe`,
        });
        issues += 1;
      }
    } catch (error) {
      await upsertIssue(input.prisma, {
        contaId: account.contaId,
        billingAccountId: account.id,
        environment,
        severity: 'CRITICAL',
        code: 'SUBSCRIPTION_RETRIEVE_FAILED',
        title: 'Falha ao consultar assinatura Stripe',
        message: 'A reconciliação não conseguiu consultar a assinatura Stripe.',
        fingerprint: `${account.id}:subscription-retrieve-failed`,
        details: {
          error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        },
      });
      issues += 1;
    }
  }

  const stuckEvents = await input.prisma.platformBillingWebhookEvent.count({
    where: {
      environment,
      status: 'PROCESSING',
      processingTimeoutAt: { lte: new Date() },
    },
  });
  if (stuckEvents > 0 && accounts[0]) {
    await upsertIssue(input.prisma, {
      contaId: accounts[0].contaId,
      environment,
      severity: 'WARNING',
      code: 'WEBHOOK_EVENTS_STUCK',
      title: 'Eventos Stripe presos em processamento',
      message: 'Há eventos Stripe com timeout de processamento expirado.',
      fingerprint: `${environment}:webhook-stuck`,
      details: { count: stuckEvents },
    });
    issues += 1;
  }

  return {
    checkedAccounts: accounts.length,
    issues,
  };
}

/**
 * Atualiza rapidamente o snapshot do cartão quando a conta acabou de voltar
 * do Checkout/Customer Portal. O Stripe pode salvar o método no Customer sem
 * preenchê-lo em subscription.default_payment_method.
 */
export async function refreshPlatformBillingPaymentMethod(input: {
  prisma: PrismaClient;
  contaId: string;
  environment?: PlatformBillingEnvironment;
}): Promise<boolean> {
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const account = await input.prisma.platformBillingAccount.findUnique({
    where: {
      uq_platform_billing_account_conta_env: {
        contaId: input.contaId,
        environment,
      },
    },
  });

  if (!account?.stripeCustomerId) return false;

  const hasPaymentSnapshot = Boolean(
    account.paymentMethodStatus === 'PRESENT' &&
    account.paymentMethodType === 'card' &&
    account.paymentMethodLast4,
  );
  if (hasPaymentSnapshot) return false;

  const paymentMethod = await resolvePaymentMethod(account, account.stripeCustomerId);
  if (!paymentMethod) return false;

  await input.prisma.platformBillingAccount.update({
    where: { id: account.id },
    data: {
      paymentMethodStatus: paymentMethod.status,
      paymentMethodType: paymentMethod.type,
      paymentMethodBrand: paymentMethod.brand,
      paymentMethodLast4: paymentMethod.last4,
      paymentMethodExpMonth: paymentMethod.expMonth,
      paymentMethodExpYear: paymentMethod.expYear,
      lastReconciledAt: new Date(),
    },
  });

  return true;
}

async function correctAccountFromStripeSubscription(prisma: PrismaClient, input: {
  account: ReconciliationAccount;
  subscription: StripeSubscriptionRecord;
  planCode: PlatformPlanCode;
  environment: PlatformBillingEnvironment;
  paymentMethod: Awaited<ReturnType<typeof resolvePaymentMethod>>;
}): Promise<boolean> {
  const now = new Date();
  const desiredStatus = mapStripeSubscriptionStatus(input.subscription.status);
  const policyAccount = {
    ...input.account,
    status: desiredStatus,
    planCode: input.planCode,
    currentPeriodEnd: input.subscription.currentPeriodEnd,
    cancelAtPeriodEnd: input.subscription.cancelAtPeriodEnd,
    trialEndsAt: input.subscription.trialEndsAt,
    paymentMethodStatus: input.paymentMethod?.status ?? input.account.paymentMethodStatus,
  };
  const desiredAccessStatus = derivePlatformAccessStatus({ account: policyAccount, now });
  const restrictionReason = derivePlatformRestrictionReason({ account: policyAccount, now });
  const shouldClearPendingPlan = Boolean(
    input.account.pendingPlanCode &&
    input.account.pendingPlanCode === input.planCode &&
    (desiredStatus === 'ACTIVE' || desiredStatus === 'TRIALING' || desiredStatus === 'PAST_DUE' || desiredStatus === 'UNPAID'),
  );
  const failedAt = input.account.lastPaymentFailedAt ?? now;
  const update: Prisma.PlatformBillingAccountUpdateInput = {
    lastReconciledAt: now,
  };

  if (input.account.status !== desiredStatus) update.status = desiredStatus;
  if (input.account.accessStatus !== desiredAccessStatus) update.accessStatus = desiredAccessStatus;
  if (input.account.restrictionReason !== restrictionReason) update.restrictionReason = restrictionReason;
  if (input.account.planCode !== input.planCode) update.planCode = input.planCode;
  if (input.subscription.customerId && input.account.stripeCustomerId !== input.subscription.customerId) {
    update.stripeCustomerId = input.subscription.customerId;
  }
  if (input.account.stripeSubscriptionId !== input.subscription.id) update.stripeSubscriptionId = input.subscription.id;
  if (input.account.stripePriceId !== input.subscription.priceId) update.stripePriceId = input.subscription.priceId;
  if (!sameInstant(input.account.currentPeriodEnd, input.subscription.currentPeriodEnd)) {
    update.currentPeriodEnd = input.subscription.currentPeriodEnd;
  }
  if (input.account.cancelAtPeriodEnd !== input.subscription.cancelAtPeriodEnd) {
    update.cancelAtPeriodEnd = input.subscription.cancelAtPeriodEnd;
  }
  if (!sameInstant(input.account.trialEndsAt, input.subscription.trialEndsAt)) {
    update.trialEndsAt = input.subscription.trialEndsAt;
  }
  if (input.paymentMethod) {
    if (input.account.paymentMethodStatus !== input.paymentMethod.status) {
      update.paymentMethodStatus = input.paymentMethod.status;
    }
    if (input.account.paymentMethodType !== input.paymentMethod.type) update.paymentMethodType = input.paymentMethod.type;
    if (input.account.paymentMethodBrand !== input.paymentMethod.brand) update.paymentMethodBrand = input.paymentMethod.brand;
    if (input.account.paymentMethodLast4 !== input.paymentMethod.last4) update.paymentMethodLast4 = input.paymentMethod.last4;
    if (input.account.paymentMethodExpMonth !== input.paymentMethod.expMonth) update.paymentMethodExpMonth = input.paymentMethod.expMonth;
    if (input.account.paymentMethodExpYear !== input.paymentMethod.expYear) update.paymentMethodExpYear = input.paymentMethod.expYear;
  }

  if (desiredAccessStatus === 'ACTIVE') {
    if (input.account.gracePeriodEndsAt) update.gracePeriodEndsAt = null;
    if (input.account.restrictedAt) update.restrictedAt = null;
    if (input.account.lastPaymentFailedAt) update.lastPaymentFailedAt = null;
    if (input.account.gracePeriodStartedAt) update.gracePeriodStartedAt = null;
  } else if (desiredAccessStatus === 'GRACE_PERIOD') {
    if (!input.account.lastPaymentFailedAt) update.lastPaymentFailedAt = failedAt;
    if (!input.account.gracePeriodEndsAt) update.gracePeriodEndsAt = computeGracePeriodEnd({ failedAt });
    if (!input.account.gracePeriodStartedAt) update.gracePeriodStartedAt = failedAt;
    if (input.account.restrictedAt) update.restrictedAt = null;
  } else if (desiredAccessStatus === 'RESTRICTED') {
    if (!input.account.restrictedAt) update.restrictedAt = now;
  } else if (desiredAccessStatus === 'CANCELED') {
    if (!input.account.canceledAt) update.canceledAt = now;
  }

  if (shouldClearPendingPlan) {
    update.pendingPlanCode = null;
    update.pendingChangeType = null;
    update.pendingChangeEffectiveAt = null;
  }
  if (!input.subscription.cancelAtPeriodEnd && input.account.pendingChangeType === 'CANCEL_AT_PERIOD_END') {
    update.pendingChangeType = null;
    update.pendingChangeEffectiveAt = null;
  }

  const shouldInspectStaleCancellationChange = !input.subscription.cancelAtPeriodEnd;
  const hasStaleCancellationChange = shouldInspectStaleCancellationChange
    ? await prisma.platformBillingPlanChange.count({
        where: {
          billingAccountId: input.account.id,
          type: 'CANCEL_AT_PERIOD_END',
          status: 'PENDING_EFFECTIVE_DATE',
        },
      }).then((count) => count > 0)
    : false;

  const correctionFields = Object.keys(update).filter((field) => field !== 'lastReconciledAt');

  if (correctionFields.length === 0 && !hasStaleCancellationChange) {
    await prisma.platformBillingAccount.update({
      where: { id: input.account.id },
      data: {
        lastReconciledAt: now,
      },
    });
    return false;
  }

  update.lastStripeEventId = `reconciliation:${input.subscription.id}`;

  await prisma.$transaction(async (tx) => {
    if (Object.keys(update).length > 0) {
      await tx.platformBillingAccount.update({
        where: { id: input.account.id },
        data: update,
      });
    }
    if (hasStaleCancellationChange) {
      await tx.platformBillingPlanChange.updateMany({
        where: {
          billingAccountId: input.account.id,
          type: 'CANCEL_AT_PERIOD_END',
          status: 'PENDING_EFFECTIVE_DATE',
        },
        data: {
          status: 'CANCELED',
          canceledAt: now,
        },
      });
    }
    await tx.platformBillingAuditLog.create({
      data: {
        contaId: input.account.contaId,
        billingAccountId: input.account.id,
        actorUserId: null,
        action: 'PLATFORM_BILLING_RECONCILIATION_CORRECTED',
        entityType: 'StripeSubscription',
        entityId: input.subscription.id,
        correlationId: `reconciliation:${input.subscription.id}`,
        metadata: {
          environment: input.environment,
          stripeStatus: input.subscription.status,
          planCode: input.planCode,
          priceId: input.subscription.priceId,
          correctedFields: [
            ...correctionFields,
            ...(hasStaleCancellationChange ? ['staleCancellationPlanChange'] : []),
          ],
        },
      },
    });
    await tx.platformBillingIssue.updateMany({
      where: {
        billingAccountId: input.account.id,
        status: 'OPEN',
        code: {
          in: [
            'ACTIVE_LOCAL_WITHOUT_SUBSCRIPTION',
            'SUBSCRIPTION_PRICE_DIVERGENT',
            'PLAN_DIVERGENT_FROM_STRIPE_PRICE',
            'ACTIVE_LOCAL_CANCELED_ON_STRIPE',
          ],
        },
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
      },
    });
  });

  return true;
}

async function resolvePaymentMethod(
  account: Pick<ReconciliationAccount, 'stripeCustomerId' | 'stripeSubscriptionId'>,
  subscriptionCustomerId?: string | null,
) {
  const customerId = account.stripeCustomerId ?? subscriptionCustomerId ?? null;
  if (!customerId) return null;
  try {
    const paymentMethod = await retrieveStripeDefaultPaymentMethod(getStripeClient(process.env), {
      customerId,
      subscriptionId: account.stripeSubscriptionId,
    });
    if (!paymentMethod) return { status: 'MISSING' as const, type: null, brand: null, last4: null, expMonth: null, expYear: null };
    return {
      status: 'PRESENT' as const,
      type: paymentMethod.type,
      brand: paymentMethod.brand,
      last4: paymentMethod.last4,
      expMonth: paymentMethod.expMonth,
      expYear: paymentMethod.expYear,
    };
  } catch {
    return null;
  }
}

function mapStripeSubscriptionStatus(status: string): PlatformBillingAccountStatus {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELED';
    case 'incomplete':
      return 'INCOMPLETE';
    case 'incomplete_expired':
      return 'INCOMPLETE_EXPIRED';
    case 'unpaid':
      return 'UNPAID';
    case 'paused':
      return 'PAUSED';
    default:
      return 'UNKNOWN';
  }
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

async function upsertIssue(prisma: PrismaClient, input: ReconciliationIssueInput): Promise<void> {
  await prisma.platformBillingIssue.upsert({
    where: {
      uq_platform_billing_issue_env_fingerprint: {
        environment: input.environment,
        fingerprint: input.fingerprint,
      },
    },
    create: {
      contaId: input.contaId,
      billingAccountId: input.billingAccountId,
      environment: input.environment,
      severity: input.severity,
      status: 'OPEN',
      code: input.code,
      title: input.title,
      message: input.message,
      fingerprint: input.fingerprint,
      details: input.details as Prisma.InputJsonValue | undefined,
      correlationId: input.correlationId,
    },
    update: {
      severity: input.severity,
      status: 'OPEN',
      title: input.title,
      message: input.message,
      details: input.details as Prisma.InputJsonValue | undefined,
      detectedAt: new Date(),
      resolvedAt: null,
      ignoredAt: null,
      correlationId: input.correlationId,
    },
  });
}
