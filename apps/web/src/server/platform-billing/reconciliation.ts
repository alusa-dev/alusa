import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import {
  computeGracePeriodEnd,
  createDefaultPlatformBillingStripeGateway,
  derivePlatformAccessStatus,
  derivePlatformRestrictionReason,
  resolvePlanCodeFromStripePriceId,
  resolveStripePriceId,
  type PlatformBillingAccessStatus,
  type PlatformBillingAccountStatus,
  type PlatformBillingEnvironment,
  type PlatformPlanCode,
  type PublicPlatformPlanCode,
} from '@alusa/platform-billing';
import {
  getStripeClient,
  getStripeMissingCustomerId,
  listStripePaidInvoices,
  retrieveStripeCustomer,
  retrieveStripeDefaultPaymentMethod,
  type StripeInvoiceRecord,
  type StripeSubscriptionRecord,
} from '@alusa/stripe';
import { resolvePlatformBillingEnvironment } from './platform-billing-server';
import { runWithTenant } from '@/lib/prisma-tenant';

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
  pendingChangeOperationId: string | null;
  pendingChangeClaimToken: string | null;
  lastProviderEventCreatedAt: Date | null;
  lastStripeEventId: string | null;
  lastReconciledAt: Date | null;
  updatedAt: Date;
};

type ReconciliationIssueInput = {
  contaId?: string | null;
  billingAccountId?: string | null;
  environment: PlatformBillingEnvironment;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  code: string;
  title: string;
  message: string;
  fingerprint: string;
  details?: Record<string, unknown>;
  correlationId?: string;
};

export type StuckWebhookEventGroup = {
  contaId: string | null;
  count: number;
};

export type ClassifiedStuckWebhookEvents = {
  tenantCounts: Record<string, number>;
  platformCount: number;
};

/**
 * Eventos sem tenant válido são problemas da plataforma. Nunca os atribua ao
 * primeiro tenant retornado pela consulta de contas.
 */
export function classifyStuckWebhookEventGroups(
  groups: readonly StuckWebhookEventGroup[],
  validTenantIds: ReadonlySet<string>,
): ClassifiedStuckWebhookEvents {
  const tenantCounts: Record<string, number> = {};
  let platformCount = 0;

  for (const group of groups) {
    if (group.contaId && validTenantIds.has(group.contaId)) {
      tenantCounts[group.contaId] = (tenantCounts[group.contaId] ?? 0) + group.count;
    } else {
      platformCount += group.count;
    }
  }

  return { tenantCounts, platformCount };
}

export async function reconcilePlatformBilling(input: {
  prisma?: PrismaClient;
  contaId?: string;
  limit?: number;
  environment?: PlatformBillingEnvironment;
}): Promise<{ checkedAccounts: number; issues: number }> {
  const db = input.prisma ?? defaultPrisma;
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const accounts = await db.platformBillingAccount.findMany({
    where: {
      environment,
      ...(input.contaId ? { contaId: input.contaId } : {}),
    },
    // Rotate through accounts independently of unrelated updatedAt writes so
    // accounts without subscriptions cannot permanently occupy the first page.
    orderBy: [{ lastReconciledAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });

  const gateway = createDefaultPlatformBillingStripeGateway(process.env);
  let issues = 0;

  for (const candidate of accounts) {
    await db.platformBillingAccount.updateMany({
      where: { id: candidate.id, contaId: candidate.contaId, environment },
      data: { lastReconciledAt: new Date() },
    });
    // Use a post-claim snapshot. The provider retrieval may take seconds, and
    // a webhook or user action during that time must win over this stale read.
    const account = await db.platformBillingAccount.findUnique({ where: { id: candidate.id } });
    if (!account || account.contaId !== candidate.contaId || account.environment !== environment) continue;
    if (!account.stripeCustomerId) {
      await upsertIssue(db, {
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
        await upsertIssue(db, {
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
      if (
        account.stripeCustomerId &&
        subscription.customerId &&
        account.stripeCustomerId !== subscription.customerId
      ) {
        await upsertIssue(db, {
          contaId: account.contaId,
          billingAccountId: account.id,
          environment,
          severity: 'CRITICAL',
          code: 'CUSTOMER_ID_DIVERGENT',
          title: 'Customer Stripe divergente',
          message: 'A assinatura e a conta de billing referenciam customers diferentes.',
          fingerprint: `${account.id}:customer-id-divergent`,
        });
        issues += 1;
        continue;
      }
      let missingCustomerId: string | null = null;
      const customerIdToValidate = subscription.customerId ?? account.stripeCustomerId;
      if (subscription.status === 'canceled' && customerIdToValidate) {
        try {
          const customer = await retrieveStripeCustomer(getStripeClient(process.env), customerIdToValidate);
          if (customer.deleted) missingCustomerId = customer.id;
        } catch (error) {
          const stripeMissingCustomerId = getStripeMissingCustomerId(error);
          if (stripeMissingCustomerId !== customerIdToValidate) throw error;
          missingCustomerId = stripeMissingCustomerId;
        }
      }
      const clearInvalidStripeCustomer = Boolean(
        missingCustomerId && (!account.stripeCustomerId || missingCustomerId === account.stripeCustomerId),
      );
      const paymentMethod = clearInvalidStripeCustomer
        ? emptyPaymentMethodSnapshot()
        : await resolvePaymentMethod(account, subscription.customerId);
      const invoiceCustomerId = subscription.customerId ?? account.stripeCustomerId;
      let paidInvoices: StripeInvoiceRecord[];
      try {
        paidInvoices = await listPaidInvoices(invoiceCustomerId);
      } catch (error) {
        if (
          subscription.status !== 'canceled' ||
          !invoiceCustomerId ||
          missingCustomerId !== invoiceCustomerId ||
          getStripeMissingCustomerId(error) !== invoiceCustomerId
        ) throw error;
        // Customer absence was independently confirmed above. Keep invoice
        // history already stored locally and do not query another customer.
        paidInvoices = [];
      }
      if (
        subscription.priceId &&
        account.stripePriceId &&
        subscription.priceId !== account.stripePriceId
      ) {
        await upsertIssue(db, {
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

      let resolvedPlanCode: PlatformPlanCode | null = null;
      if (subscription.priceId) {
        try {
          const resolved = resolvePlanCodeFromStripePriceId(subscription.priceId, {
            ...process.env,
            STRIPE_ENVIRONMENT: environment,
          });
          resolvedPlanCode = resolved.planCode;
          if (account.planCode && resolved.planCode !== account.planCode) {
            await upsertIssue(db, {
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
          if ((account.planCode === 'CUSTOM' || account.pendingPlanCode === 'CUSTOM') && account.stripePriceId === subscription.priceId) {
            resolvedPlanCode = 'CUSTOM';
          } else await upsertIssue(db, {
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

      const correctionPlanCode = resolvedPlanCode;
      let correctionAttempted = false;
      if (correctionPlanCode || missingCustomerId) {
        correctionAttempted = true;
        await correctAccountFromStripeSubscription(db, {
          account,
          subscription,
          planCode: correctionPlanCode,
          environment,
          paymentMethod,
          paidInvoices,
          missingStripeCustomerId: missingCustomerId,
        });
      }

      const postCorrectionAccount = correctionAttempted
        ? await db.platformBillingAccount.findFirst({
            where: { id: account.id, contaId: account.contaId, environment },
            select: { accessStatus: true },
          })
        : account;
      if (postCorrectionAccount?.accessStatus === 'ACTIVE' && subscription.status === 'canceled') {
        await upsertIssue(db, {
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
      await upsertIssue(db, {
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

  const stuckEventGroups = await db.platformBillingWebhookEvent.groupBy({
    by: ['contaId'],
    where: {
      environment,
      ...(input.contaId ? { contaId: input.contaId } : {}),
      status: 'PROCESSING',
      processingTimeoutAt: { lte: new Date() },
    },
    _count: { _all: true },
  });
  if (stuckEventGroups.length > 0) {
    const candidateTenantIds = stuckEventGroups
      .map((group) => group.contaId)
      .filter((contaId): contaId is string => Boolean(contaId));
    const validTenants = candidateTenantIds.length
      ? await db.conta.findMany({
          where: { id: { in: candidateTenantIds } },
          select: { id: true },
        })
      : [];
    const classified = classifyStuckWebhookEventGroups(
      stuckEventGroups.map((group) => ({
        contaId: group.contaId,
        count: group._count._all,
      })),
      new Set(validTenants.map((tenant) => tenant.id)),
    );

    for (const [contaId, count] of Object.entries(classified.tenantCounts)) {
      await upsertIssue(db, {
        contaId,
        environment,
        severity: 'WARNING',
        code: 'WEBHOOK_EVENTS_STUCK',
        title: 'Eventos Stripe presos em processamento',
        message: 'Há eventos Stripe com timeout de processamento expirado.',
        fingerprint: `${environment}:webhook-stuck:tenant:${contaId}`,
        details: { scope: 'TENANT', contaId, count },
      });
      issues += 1;
    }

    if (classified.platformCount > 0) {
      await upsertIssue(db, {
        contaId: null,
        billingAccountId: null,
        environment,
        severity: 'WARNING',
        code: 'WEBHOOK_EVENTS_STUCK',
        title: 'Eventos Stripe presos em processamento',
        message: 'Há eventos Stripe sem tenant válido com timeout de processamento expirado.',
        // Mantém o fingerprint legado para que a correção também recupere a
        // issue global que versões antigas associaram arbitrariamente a uma conta.
        fingerprint: `${environment}:webhook-stuck`,
        details: { scope: 'PLATFORM', count: classified.platformCount },
      });
      issues += 1;
    }
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
  prisma?: PrismaClient;
  contaId: string;
  environment?: PlatformBillingEnvironment;
  /** Force a fresh provider read after the customer returns from Stripe Portal. */
  force?: boolean;
}): Promise<boolean> {
  const db = input.prisma ?? defaultPrisma;
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const accountQuery = () => db.platformBillingAccount.findUnique({
    where: {
      uq_platform_billing_account_conta_env: {
        contaId: input.contaId,
        environment,
      },
    },
  });
  const account = input.prisma
    ? await accountQuery()
    : await runWithTenant(input.contaId, (tx) => tx.platformBillingAccount.findUnique({
        where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment } },
      }));

  if (!account?.stripeCustomerId) return false;

  const hasPaymentSnapshot = Boolean(
    account.paymentMethodStatus === 'PRESENT' &&
    account.paymentMethodType === 'card' &&
    account.paymentMethodLast4,
  );
  if (hasPaymentSnapshot && !input.force) return false;

  const paymentMethod = await resolvePaymentMethod(account, account.stripeCustomerId);
  if (!paymentMethod) return false;

  const updateData = {
    paymentMethodStatus: paymentMethod.status,
    paymentMethodType: paymentMethod.type,
    paymentMethodBrand: paymentMethod.brand,
    paymentMethodLast4: paymentMethod.last4,
    paymentMethodExpMonth: paymentMethod.expMonth,
    paymentMethodExpYear: paymentMethod.expYear,
    lastReconciledAt: new Date(),
  };
  const updated = input.prisma
    ? await db.platformBillingAccount.updateMany({
        where: {
          id: account.id,
          contaId: input.contaId,
          environment,
          stripeCustomerId: account.stripeCustomerId,
          stripeSubscriptionId: account.stripeSubscriptionId,
        },
        data: updateData,
      })
    : await runWithTenant(input.contaId, (tx) => tx.platformBillingAccount.updateMany({
        where: {
          id: account.id,
          contaId: input.contaId,
          environment,
          stripeCustomerId: account.stripeCustomerId,
          stripeSubscriptionId: account.stripeSubscriptionId,
        },
        data: updateData,
      }));

  return updated.count > 0;
}

export async function correctAccountFromStripeSubscription(
  prisma: PrismaClient,
  input: {
    account: ReconciliationAccount;
    subscription: StripeSubscriptionRecord;
    planCode: PlatformPlanCode | null;
    environment: PlatformBillingEnvironment;
    paymentMethod: Awaited<ReturnType<typeof resolvePaymentMethod>>;
    paidInvoices: StripeInvoiceRecord[];
    missingStripeCustomerId?: string | null;
  },
): Promise<boolean> {
  const now = new Date();
  const paymentHistory = resolvePaymentHistory(input.paidInvoices);
  const desiredStatus = mapStripeSubscriptionStatus(input.subscription.status);
  const planCode = input.planCode ?? input.account.planCode;
  const policyAccount = {
    ...input.account,
    status: desiredStatus,
    planCode,
    currentPeriodEnd: input.subscription.currentPeriodEnd,
    cancelAtPeriodEnd: input.subscription.cancelAtPeriodEnd,
    trialEndsAt: input.subscription.trialEndsAt,
    paymentMethodStatus: input.paymentMethod?.status ?? input.account.paymentMethodStatus,
    firstPaidAt: input.account.firstPaidAt ?? paymentHistory.firstPaidAt,
    lastSuccessfulPaymentAt:
      input.account.lastSuccessfulPaymentAt ?? paymentHistory.lastSuccessfulPaymentAt,
  };
  const desiredAccessStatus = derivePlatformAccessStatus({ account: policyAccount, now });
  const restrictionReason = derivePlatformRestrictionReason({ account: policyAccount, now });
  const shouldClearPendingPlan = Boolean(
    input.account.pendingChangeOperationId &&
    (input.account.pendingChangeType === 'UPGRADE' ||
      input.account.pendingChangeType === 'DOWNGRADE') &&
    input.account.pendingPlanCode &&
    input.account.pendingPlanCode === planCode &&
    input.subscription.priceId === (input.account.pendingPlanCode === 'CUSTOM'
      ? input.account.stripePriceId
      : resolveStripePriceId({
          planCode: input.account.pendingPlanCode as PublicPlatformPlanCode,
          environment: input.environment,
          source: process.env,
        })) &&
    (desiredStatus === 'ACTIVE' ||
      desiredStatus === 'TRIALING' ||
      desiredStatus === 'PAST_DUE' ||
      desiredStatus === 'UNPAID'),
  );
  const failedAt = input.account.lastPaymentFailedAt ?? now;
  const update: Prisma.PlatformBillingAccountUpdateInput = {
    lastReconciledAt: now,
  };

  if (input.account.status !== desiredStatus) update.status = desiredStatus;
  if (input.account.accessStatus !== desiredAccessStatus) update.accessStatus = desiredAccessStatus;
  if (input.account.restrictionReason !== restrictionReason)
    update.restrictionReason = restrictionReason;
  if (planCode && input.account.planCode !== planCode) update.planCode = planCode;
  if (input.missingStripeCustomerId && input.missingStripeCustomerId === input.account.stripeCustomerId) {
    update.stripeCustomerId = null;
  } else if (!input.missingStripeCustomerId &&
    input.subscription.customerId &&
    input.account.stripeCustomerId !== input.subscription.customerId
  ) {
    update.stripeCustomerId = input.subscription.customerId;
  }
  if (input.account.stripeSubscriptionId !== input.subscription.id)
    update.stripeSubscriptionId = input.subscription.id;
  if (input.account.stripePriceId !== input.subscription.priceId)
    update.stripePriceId = input.subscription.priceId;
  if (
    paymentHistory.firstPaidAt &&
    (!input.account.firstPaidAt || paymentHistory.firstPaidAt < input.account.firstPaidAt)
  ) {
    update.firstPaidAt = paymentHistory.firstPaidAt;
  }
  if (
    paymentHistory.lastSuccessfulPaymentAt &&
    (!input.account.lastSuccessfulPaymentAt ||
      paymentHistory.lastSuccessfulPaymentAt > input.account.lastSuccessfulPaymentAt)
  ) {
    update.lastSuccessfulPaymentAt = paymentHistory.lastSuccessfulPaymentAt;
  }
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
    if (input.account.paymentMethodType !== input.paymentMethod.type)
      update.paymentMethodType = input.paymentMethod.type;
    if (input.account.paymentMethodBrand !== input.paymentMethod.brand)
      update.paymentMethodBrand = input.paymentMethod.brand;
    if (input.account.paymentMethodLast4 !== input.paymentMethod.last4)
      update.paymentMethodLast4 = input.paymentMethod.last4;
    if (input.account.paymentMethodExpMonth !== input.paymentMethod.expMonth)
      update.paymentMethodExpMonth = input.paymentMethod.expMonth;
    if (input.account.paymentMethodExpYear !== input.paymentMethod.expYear)
      update.paymentMethodExpYear = input.paymentMethod.expYear;
  }

  if (desiredAccessStatus === 'ACTIVE') {
    if (input.account.gracePeriodEndsAt) update.gracePeriodEndsAt = null;
    if (input.account.restrictedAt) update.restrictedAt = null;
    if (input.account.lastPaymentFailedAt) update.lastPaymentFailedAt = null;
    if (input.account.gracePeriodStartedAt) update.gracePeriodStartedAt = null;
  } else if (desiredAccessStatus === 'GRACE_PERIOD') {
    if (!input.account.lastPaymentFailedAt) update.lastPaymentFailedAt = failedAt;
    if (!input.account.gracePeriodEndsAt)
      update.gracePeriodEndsAt = computeGracePeriodEnd({ failedAt });
    if (!input.account.gracePeriodStartedAt) update.gracePeriodStartedAt = failedAt;
    if (input.account.restrictedAt) update.restrictedAt = null;
  } else if (desiredAccessStatus === 'RESTRICTED') {
    if (!input.account.restrictedAt) update.restrictedAt = now;
  } else if (desiredAccessStatus === 'CANCELED') {
    const canceledAt = input.subscription.canceledAt ?? input.account.canceledAt ?? now;
    if (!sameInstant(input.account.canceledAt, canceledAt)) update.canceledAt = canceledAt;
  }

  if (shouldClearPendingPlan) {
    update.pendingPlanCode = null;
    update.pendingChangeType = null;
    update.pendingChangeEffectiveAt = null;
    update.pendingChangeOperationId = null;
    update.pendingChangeClaimToken = null;
    update.pendingChangeClaimedAt = null;
  }
  if (
    !input.subscription.cancelAtPeriodEnd &&
    input.account.pendingChangeType === 'CANCEL_AT_PERIOD_END'
  ) {
    update.pendingChangeType = null;
    update.pendingChangeEffectiveAt = null;
  }

  const shouldInspectStaleCancellationChange = !input.subscription.cancelAtPeriodEnd;
  const hasStaleCancellationChange = shouldInspectStaleCancellationChange
    ? await prisma.platformBillingPlanChange
        .count({
          where: {
            contaId: input.account.contaId,
            billingAccountId: input.account.id,
            environment: input.environment,
            stripeSubscriptionId: input.subscription.id,
            type: 'CANCEL_AT_PERIOD_END',
            status: 'PENDING_EFFECTIVE_DATE',
          },
        })
        .then((count) => count > 0)
    : false;
  const hasPendingPlanChangesToCancel = input.subscription.status === 'canceled'
    ? await prisma.platformBillingPlanChange.count({
        where: {
          contaId: input.account.contaId,
          billingAccountId: input.account.id,
          environment: input.environment,
          stripeSubscriptionId: input.subscription.id,
          type: { in: ['UPGRADE', 'DOWNGRADE'] },
          status: { in: ['PENDING_PAYMENT', 'PENDING_EFFECTIVE_DATE'] },
        },
      }).then((count) => count > 0)
    : false;

  const correctionFields = Object.keys(update).filter((field) => field !== 'lastReconciledAt');

  if (
    correctionFields.length === 0 &&
    !hasStaleCancellationChange &&
    !hasPendingPlanChangesToCancel &&
    input.paidInvoices.length === 0
  ) {
    await prisma.platformBillingAccount.update({
      where: { id: input.account.id },
      data: {
        lastReconciledAt: now,
      },
    });
    return false;
  }

  update.lastStripeEventId = `reconciliation:${input.subscription.id}`;

  class PendingPlanChangeCasLost extends Error {}

  let applied: boolean;
  try {
    applied = await prisma.$transaction(async (tx) => {
    const accountCas = await tx.platformBillingAccount.updateMany({
      where: {
        id: input.account.id,
        contaId: input.account.contaId,
        environment: input.environment,
        updatedAt: input.account.updatedAt,
        lastProviderEventCreatedAt: input.account.lastProviderEventCreatedAt,
        lastStripeEventId: input.account.lastStripeEventId,
        status: input.account.status,
        accessStatus: input.account.accessStatus,
        planCode: input.account.planCode,
        stripePriceId: input.account.stripePriceId,
        currentPeriodEnd: input.account.currentPeriodEnd,
        cancelAtPeriodEnd: input.account.cancelAtPeriodEnd,
        trialEndsAt: input.account.trialEndsAt,
        stripeSubscriptionId: input.account.stripeSubscriptionId,
        pendingChangeOperationId: input.account.pendingChangeOperationId,
        pendingChangeClaimToken: input.account.pendingChangeClaimToken,
      },
      data: update,
    });
    if (accountCas.count !== 1) return false;

    if (shouldClearPendingPlan && input.account.pendingChangeOperationId) {
      const planChangeCas = await tx.platformBillingPlanChange.updateMany({
        where: {
          id: input.account.pendingChangeOperationId,
          contaId: input.account.contaId,
          billingAccountId: input.account.id,
          environment: input.environment,
          stripeSubscriptionId: input.subscription.id,
          stripePriceId: input.subscription.priceId,
          toPlanCode: input.account.pendingPlanCode,
          type: input.account.pendingChangeType as 'UPGRADE' | 'DOWNGRADE',
          status:
            input.account.pendingChangeType === 'UPGRADE'
              ? 'PENDING_PAYMENT'
              : 'PENDING_EFFECTIVE_DATE',
        },
        data: {
          status: 'APPLIED',
          appliedAt: now,
          stripePriceId: input.subscription.priceId,
        },
      });
      if (planChangeCas.count !== 1) throw new PendingPlanChangeCasLost();
    }

    for (const invoice of input.paidInvoices) {
      const priceId = invoice.priceId ?? input.subscription.priceId ?? input.account.stripePriceId;
      await tx.platformBillingInvoice.upsert({
        where: {
          uq_platform_billing_invoice_env_invoice: {
            environment: input.environment,
            stripeInvoiceId: invoice.id,
          },
        },
        create: {
          contaId: input.account.contaId,
          billingAccountId: input.account.id,
          environment: input.environment,
          stripeInvoiceId: invoice.id,
          stripeCustomerId: invoice.customerId,
          stripeSubscriptionId: invoice.subscriptionId ?? input.subscription.id,
          stripePriceId: priceId,
          planCode,
          number: invoice.number,
          status: 'PAID',
          amountDue: invoice.amountDue,
          amountPaid: invoice.amountPaid,
          currency: invoice.currency,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
          invoicePdf: invoice.invoicePdf,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          dueDate: invoice.dueDate,
          paidAt: invoice.paidAt ?? invoice.createdAt ?? now,
          failedAt: null,
          attempted: invoice.attempted,
          attemptCount: invoice.attemptCount,
          nextPaymentAttempt: null,
          lastPaymentErrorCode: null,
          lastPaymentErrorMessage: null,
          raw: invoice.raw as Prisma.InputJsonValue,
          lastStripeEventId: `reconciliation:invoice:${invoice.id}`,
        },
        update: {
          billingAccountId: input.account.id,
          stripeCustomerId: invoice.customerId,
          stripeSubscriptionId: invoice.subscriptionId ?? input.subscription.id,
          stripePriceId: priceId,
          planCode,
          number: invoice.number,
          status: 'PAID',
          amountDue: invoice.amountDue,
          amountPaid: invoice.amountPaid,
          currency: invoice.currency,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
          invoicePdf: invoice.invoicePdf,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          dueDate: invoice.dueDate,
          paidAt: invoice.paidAt ?? invoice.createdAt ?? now,
          failedAt: null,
          attempted: invoice.attempted,
          attemptCount: invoice.attemptCount,
          nextPaymentAttempt: null,
          lastPaymentErrorCode: null,
          lastPaymentErrorMessage: null,
          raw: invoice.raw as Prisma.InputJsonValue,
          lastStripeEventId: `reconciliation:invoice:${invoice.id}`,
        },
      });
    }
    if (hasStaleCancellationChange) {
      await tx.platformBillingPlanChange.updateMany({
        where: {
          contaId: input.account.contaId,
          billingAccountId: input.account.id,
          environment: input.environment,
          stripeSubscriptionId: input.subscription.id,
          type: 'CANCEL_AT_PERIOD_END',
          status: 'PENDING_EFFECTIVE_DATE',
        },
        data: {
          status: 'CANCELED',
          canceledAt: input.subscription.canceledAt ?? now,
        },
      });
    }
    let canceledPendingPlanChangeCount = 0;
    if (hasPendingPlanChangesToCancel) {
      const canceledPlanChanges = await tx.platformBillingPlanChange.updateMany({
        where: {
          contaId: input.account.contaId,
          billingAccountId: input.account.id,
          environment: input.environment,
          stripeSubscriptionId: input.subscription.id,
          type: { in: ['UPGRADE', 'DOWNGRADE'] },
          status: { in: ['PENDING_PAYMENT', 'PENDING_EFFECTIVE_DATE'] },
        },
        data: {
          status: 'CANCELED',
          canceledAt: input.subscription.canceledAt ?? now,
        },
      });
      canceledPendingPlanChangeCount = canceledPlanChanges.count;
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
          planCode,
          priceId: input.subscription.priceId,
          correctedFields: [
            ...correctionFields,
            ...(hasStaleCancellationChange ? ['staleCancellationPlanChange'] : []),
            ...(canceledPendingPlanChangeCount > 0 ? ['pendingPlanChangesCanceled'] : []),
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
            'FIRST_PAYMENT_INCOMPLETE',
            'PAYMENT_PAST_DUE',
            'PAYMENT_UNPAID',
            'GRACE_PERIOD_EXPIRED',
            'TRIAL_EXPIRED_WITHOUT_PAYMENT',
            'SUBSCRIPTION_RETRIEVE_FAILED',
            'ACTIVE_LOCAL_WITHOUT_SUBSCRIPTION',
            'CUSTOMER_ID_DIVERGENT',
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
    return true;
    });
  } catch (error) {
    if (error instanceof PendingPlanChangeCasLost) return false;
    throw error;
  }

  return applied;
}

async function listPaidInvoices(customerId: string | null): Promise<StripeInvoiceRecord[]> {
  if (!customerId) return [];
  return listStripePaidInvoices(getStripeClient(process.env), customerId);
}

function emptyPaymentMethodSnapshot() {
  return {
    status: 'MISSING' as const,
    type: null,
    brand: null,
    last4: null,
    expMonth: null,
    expYear: null,
  };
}

function resolvePaymentHistory(invoices: StripeInvoiceRecord[]): {
  firstPaidAt: Date | null;
  lastSuccessfulPaymentAt: Date | null;
} {
  const paidAt = invoices
    .map((invoice) => invoice.paidAt ?? invoice.createdAt)
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  return {
    firstPaidAt: paidAt[0] ?? null,
    lastSuccessfulPaymentAt: paidAt.at(-1) ?? null,
  };
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
    if (!paymentMethod)
      return {
        status: 'MISSING' as const,
        type: null,
        brand: null,
        last4: null,
        expMonth: null,
        expYear: null,
      };
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
      contaId: input.contaId ?? null,
      billingAccountId: input.billingAccountId ?? null,
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
      contaId: input.contaId ?? null,
      billingAccountId: input.billingAccountId ?? null,
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
