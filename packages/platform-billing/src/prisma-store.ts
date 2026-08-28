import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type {
  AttachPlatformBillingCustomerInput,
  CreatePlatformBillingAccountInput,
  CreatePlatformBillingCheckoutSessionRecordInput,
  MarkPlatformBillingCheckoutPendingInput,
  PlatformBillingAccountRecord,
  PlatformBillingCheckoutSessionRecord,
  PlatformBillingInvoiceRecord,
  PlatformBillingWebhookEventRecord,
  PlatformBillingStore,
} from './types';

type PlatformBillingPrismaClientBase = Pick<
  PrismaClient,
  | 'platformBillingAccount'
  | 'platformBillingCheckoutSession'
  | 'platformBillingInvoice'
  | 'platformBillingWebhookEvent'
  | 'platformBillingAuditLog'
  | 'platformBillingIssue'
  | 'platformBillingPlanChange'
  | '$executeRaw'
>;

type PlatformBillingPrismaClient = PlatformBillingPrismaClientBase & {
  $transaction?<T>(
    fn: (tx: PlatformBillingPrismaClientBase) => Promise<T>,
  ): Promise<T>;
};

export function createPrismaPlatformBillingStore(db: PlatformBillingPrismaClient): PlatformBillingStore {
  return {
    findAccount: async (input) => {
      const account = await db.platformBillingAccount.findUnique({
        where: {
          uq_platform_billing_account_conta_env: {
            contaId: input.contaId,
            environment: input.environment,
          },
        },
      });

      return account ? toAccountRecord(account) : null;
    },

    findAccountByStripeCustomerId: async (input) => {
      const account = await db.platformBillingAccount.findUnique({
        where: {
          uq_platform_billing_account_env_customer: {
            environment: input.environment,
            stripeCustomerId: input.stripeCustomerId,
          },
        },
      });

      return account ? toAccountRecord(account) : null;
    },

    findAccountByStripeSubscriptionId: async (input) => {
      const account = await db.platformBillingAccount.findUnique({
        where: {
          uq_platform_billing_account_env_subscription: {
            environment: input.environment,
            stripeSubscriptionId: input.stripeSubscriptionId,
          },
        },
      });

      return account ? toAccountRecord(account) : null;
    },

    createAccount: async (input) => {
      const account = await db.platformBillingAccount.upsert({
        where: {
          uq_platform_billing_account_conta_env: {
            contaId: input.contaId,
            environment: input.environment,
          },
        },
        create: {
          contaId: input.contaId,
          environment: input.environment,
          stripeCustomerId: input.stripeCustomerId,
          status: 'NOT_STARTED',
          accessStatus: 'PENDING',
        },
        update: {
          stripeCustomerId: input.stripeCustomerId,
        },
      });

      return toAccountRecord(account);
    },

    attachCustomer: async (input) => {
      const account = await db.platformBillingAccount.update({
        where: { id: input.accountId },
        data: { stripeCustomerId: input.stripeCustomerId },
      });

      return toAccountRecord(account);
    },

    markCheckoutPending: async (input) => {
      const reactivationData = input.pendingChangeType === 'REACTIVATE'
        ? {
            status: 'CANCELED' as const,
            accessStatus: 'CANCELED' as const,
          }
        : {
            status: 'CHECKOUT_PENDING' as const,
            accessStatus: 'PENDING' as const,
          };
      const account = await db.platformBillingAccount.update({
        where: { id: input.accountId },
        data: {
          ...reactivationData,
          pendingPlanCode: input.planCode,
          pendingChangeType: input.pendingChangeType ?? null,
          pendingChangeEffectiveAt: null,
        },
      });

      return toAccountRecord(account);
    },

    updateAccountFromStripeSubscription: async (input) => {
      const now = new Date();
      const account = await runWithOptionalTransaction(db, async (tx) => {
        const current = await tx.platformBillingAccount.findUniqueOrThrow({
          where: { id: input.accountId },
        });
        if (
          input.lastProviderEventCreatedAt &&
          current.lastProviderEventCreatedAt &&
          current.lastProviderEventCreatedAt.getTime() > input.lastProviderEventCreatedAt.getTime()
        ) {
          return current;
        }

        await tx.platformBillingAccount.update({
          where: { id: input.accountId },
          data: {
            status: input.status,
            planCode: input.planCode,
            stripeSubscriptionId: input.stripeSubscriptionId,
            stripePriceId: input.stripePriceId,
            currentPeriodEnd: input.currentPeriodEnd,
            cancelAtPeriodEnd: input.cancelAtPeriodEnd,
            trialEndsAt: input.trialEndsAt,
            accessStatus: input.accessStatus ?? deriveAccessStatusFromStripeStatus(input.status),
            gracePeriodEndsAt: input.gracePeriodEndsAt,
            restrictedAt: input.restrictedAt,
            canceledAt: input.canceledAt,
            lastPaymentFailedAt: input.lastPaymentFailedAt,
            firstPaidAt: input.firstPaidAt,
            lastSuccessfulPaymentAt: input.lastSuccessfulPaymentAt,
            paymentMethodStatus: input.paymentMethodStatus,
            paymentMethodType: input.paymentMethodType,
            paymentMethodBrand: input.paymentMethodBrand,
            paymentMethodLast4: input.paymentMethodLast4,
            paymentMethodExpMonth: input.paymentMethodExpMonth,
            paymentMethodExpYear: input.paymentMethodExpYear,
            restrictionReason: input.restrictionReason,
            gracePeriodStartedAt: input.gracePeriodStartedAt,
            lastProviderEventCreatedAt: input.lastProviderEventCreatedAt,
            trialWillEndNotifiedAt: input.trialWillEndNotifiedAt,
            pendingPlanCode: input.pendingPlanCode,
            pendingChangeType: input.pendingChangeType,
            pendingChangeEffectiveAt: input.pendingChangeEffectiveAt,
            lastStripeEventId: input.lastStripeEventId,
            ...(input.accessStatus && input.accessStatus !== current.accessStatus
              ? { accessStateVersion: { increment: 1 } }
              : {}),
          },
        });

        if (!input.cancelAtPeriodEnd) {
          await tx.platformBillingPlanChange.updateMany({
            where: {
              billingAccountId: input.accountId,
              type: 'CANCEL_AT_PERIOD_END',
              status: 'PENDING_EFFECTIVE_DATE',
            },
            data: {
              status: 'CANCELED',
              canceledAt: now,
            },
          });
          await tx.platformBillingAccount.updateMany({
            where: {
              id: input.accountId,
              pendingChangeType: 'CANCEL_AT_PERIOD_END',
            },
            data: {
              pendingChangeType: null,
              pendingChangeEffectiveAt: null,
            },
          });
        }

        return tx.platformBillingAccount.findUniqueOrThrow({
          where: { id: input.accountId },
        });
      });

      return toAccountRecord(account);
    },

    resolveOpenIssuesForPaidAccount: async (input) => {
      const resolvedAt = new Date();
      const result = await db.platformBillingIssue.updateMany({
        where: {
          contaId: input.contaId,
          billingAccountId: input.billingAccountId,
          environment: input.environment,
          status: 'OPEN',
          code: {
            in: [
              'FIRST_PAYMENT_INCOMPLETE',
              'PAYMENT_PAST_DUE',
              'PAYMENT_UNPAID',
              'GRACE_PERIOD_EXPIRED',
              'TRIAL_EXPIRED_WITHOUT_PAYMENT',
              'SUBSCRIPTION_RETRIEVE_FAILED',
            ],
          },
        },
        data: {
          status: 'RESOLVED',
          resolvedAt,
          ignoredAt: null,
        },
      });

      if (result.count > 0) {
        await db.platformBillingAuditLog.create({
          data: {
            contaId: input.contaId,
            billingAccountId: input.billingAccountId,
            actorUserId: null,
            action: 'PLATFORM_BILLING_PAYMENT_ISSUES_RESOLVED',
            entityType: 'PlatformBillingAccount',
            entityId: input.billingAccountId,
            correlationId: input.correlationId,
            metadata: {
              environment: input.environment,
              resolvedIssueCount: result.count,
            },
          },
        });
      }

      return result.count;
    },

    findCheckoutSessionByIdempotencyKey: async (input) => {
      const session = await db.platformBillingCheckoutSession.findUnique({
        where: {
          uq_platform_billing_checkout_conta_env_idempotency: {
            contaId: input.contaId,
            environment: input.environment,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });

      return session ? toCheckoutSessionRecord(session) : null;
    },

    createCheckoutSession: async (input) => {
      const session = await db.platformBillingCheckoutSession.upsert({
        where: {
          uq_platform_billing_checkout_conta_env_idempotency: {
            contaId: input.contaId,
            environment: input.environment,
            idempotencyKey: input.idempotencyKey,
          },
        },
        create: {
          contaId: input.contaId,
          billingAccountId: input.billingAccountId,
          environment: input.environment,
          planCode: input.planCode,
          stripeCheckoutSessionId: input.stripeCheckoutSessionId,
          stripeCustomerId: input.stripeCustomerId,
          stripePriceId: input.stripePriceId,
          url: input.url,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          idempotencyKey: input.idempotencyKey,
          createdByUserId: input.createdByUserId,
          expiresAt: input.expiresAt,
        },
        update: {
          url: input.url,
          expiresAt: input.expiresAt,
        },
      });

      return toCheckoutSessionRecord(session);
    },

    listInvoices: async (input) => {
      const invoices = await db.platformBillingInvoice.findMany({
        where: {
          contaId: input.contaId,
          environment: input.environment,
        },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        take: input.limit ?? 24,
      });

      return invoices.map(toInvoiceRecord);
    },

    upsertInvoice: async (input) => {
      const invoice = await db.platformBillingInvoice.upsert({
        where: {
          uq_platform_billing_invoice_env_invoice: {
            environment: input.environment,
            stripeInvoiceId: input.stripeInvoiceId,
          },
        },
        create: {
          contaId: input.contaId,
          billingAccountId: input.billingAccountId,
          environment: input.environment,
          stripeInvoiceId: input.stripeInvoiceId,
          stripeCustomerId: input.stripeCustomerId,
          stripeSubscriptionId: input.stripeSubscriptionId,
          stripePriceId: input.stripePriceId,
          planCode: input.planCode,
          number: input.number,
          status: input.status,
          amountDue: input.amountDue,
          amountPaid: input.amountPaid,
          currency: input.currency,
          hostedInvoiceUrl: input.hostedInvoiceUrl,
          invoicePdf: input.invoicePdf,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          dueDate: input.dueDate,
          paidAt: input.paidAt,
          failedAt: input.failedAt,
          attempted: input.attempted,
          attemptCount: input.attemptCount,
          nextPaymentAttempt: input.nextPaymentAttempt,
          lastPaymentErrorCode: input.lastPaymentErrorCode,
          lastPaymentErrorMessage: input.lastPaymentErrorMessage,
          raw: toPrismaJson(input.raw),
          lastStripeEventId: input.lastStripeEventId,
        },
        update: {
          billingAccountId: input.billingAccountId,
          stripeCustomerId: input.stripeCustomerId,
          stripeSubscriptionId: input.stripeSubscriptionId,
          stripePriceId: input.stripePriceId,
          planCode: input.planCode,
          number: input.number,
          status: input.status,
          amountDue: input.amountDue,
          amountPaid: input.amountPaid,
          currency: input.currency,
          hostedInvoiceUrl: input.hostedInvoiceUrl,
          invoicePdf: input.invoicePdf,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          dueDate: input.dueDate,
          paidAt: input.paidAt,
          failedAt: input.failedAt,
          attempted: input.attempted,
          attemptCount: input.attemptCount,
          nextPaymentAttempt: input.nextPaymentAttempt,
          lastPaymentErrorCode: input.lastPaymentErrorCode,
          lastPaymentErrorMessage: input.lastPaymentErrorMessage,
          raw: toPrismaJson(input.raw),
          lastStripeEventId: input.lastStripeEventId,
        },
      });

      return toInvoiceRecord(invoice);
    },

    upsertWebhookEvent: async (input) => {
      const existing = await db.platformBillingWebhookEvent.findUnique({
        where: {
          uq_platform_billing_webhook_env_event: {
            environment: input.environment,
            eventId: input.eventId,
          },
        },
      });

      if (existing) {
        return { record: toWebhookEventRecord(existing), inserted: false };
      }

      try {
        const created = await db.platformBillingWebhookEvent.create({
          data: {
            environment: input.environment,
            eventId: input.eventId,
            eventType: input.eventType,
            contaId: input.contaId,
            status: 'PENDING',
            payload: toPrismaJson(input.payload) ?? {},
            correlationId: input.correlationId ?? input.eventId,
          },
        });

        await db.$executeRaw`
          UPDATE "PlatformBillingWebhookEvent"
          SET
            "receivedAt" = LOCALTIMESTAMP,
            "nextAttemptAt" = LOCALTIMESTAMP,
            "createdAt" = LOCALTIMESTAMP,
            "updatedAt" = LOCALTIMESTAMP
          WHERE "id" = ${created.id}
        `;

        const refreshed = await db.platformBillingWebhookEvent.findUniqueOrThrow({
          where: { id: created.id },
        });

        return { record: toWebhookEventRecord(refreshed), inserted: true };
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const current = await db.platformBillingWebhookEvent.findUniqueOrThrow({
            where: {
              uq_platform_billing_webhook_env_event: {
                environment: input.environment,
                eventId: input.eventId,
              },
            },
          });
          return { record: toWebhookEventRecord(current), inserted: false };
        }
        throw error;
      }
    },

    markWebhookEventProcessing: async (input) => {
      const record = await db.platformBillingWebhookEvent.update({
        where: { id: input.id },
        data: {
          status: 'PROCESSING',
          contaId: input.contaId,
          lockedAt: new Date(),
          lastAttemptAt: new Date(),
          processingTimeoutAt: input.processingTimeoutAt,
          workerId: input.workerId,
          attempts: { increment: 1 },
        },
      });
      return toWebhookEventRecord(record);
    },

    markWebhookEventProcessed: async (input) => {
      const record = await db.platformBillingWebhookEvent.update({
        where: { id: input.id },
        data: {
          status: 'PROCESSED',
          contaId: input.contaId,
          processedAt: new Date(),
          lockedAt: null,
          processingTimeoutAt: null,
          workerId: null,
          lastError: null,
          lastErrorCode: null,
        },
      });
      return toWebhookEventRecord(record);
    },

    markWebhookEventIgnored: async (input) => {
      const record = await db.platformBillingWebhookEvent.update({
        where: { id: input.id },
        data: {
          status: 'IGNORED',
          contaId: input.contaId,
          processedAt: new Date(),
          lockedAt: null,
          processingTimeoutAt: null,
          workerId: null,
        },
      });
      return toWebhookEventRecord(record);
    },

    markWebhookEventFailed: async (input) => {
      const record = await db.platformBillingWebhookEvent.update({
        where: { id: input.id },
        data: {
          status: input.exhausted ? 'EXHAUSTED' : 'FAILED',
          contaId: input.contaId,
          lockedAt: null,
          processingTimeoutAt: null,
          workerId: null,
          lastError: input.error.slice(0, 1000),
          lastErrorCode: input.errorCode,
          exhaustedAt: input.exhausted ? new Date() : null,
        },
      });

      if (!input.exhausted && input.nextAttemptAt) {
        const delayMs = Math.max(0, input.nextAttemptAt.getTime() - Date.now());
        await db.$executeRaw`
          UPDATE "PlatformBillingWebhookEvent"
          SET
            "nextAttemptAt" = LOCALTIMESTAMP + (${delayMs}::text || ' milliseconds')::interval,
            "updatedAt" = LOCALTIMESTAMP
          WHERE "id" = ${input.id}
        `;

        const refreshed = await db.platformBillingWebhookEvent.findUniqueOrThrow({
          where: { id: input.id },
        });
        return toWebhookEventRecord(refreshed);
      }

      return toWebhookEventRecord(record);
    },

    createAuditLog: async (input) => {
      await db.platformBillingAuditLog.create({
        data: {
          contaId: input.contaId,
          billingAccountId: input.billingAccountId,
          actorUserId: input.actorUserId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          correlationId: input.correlationId,
          metadata: toPrismaJson(input.metadata),
        },
      });
    },
  };
}

function toAccountRecord(account: {
  id: string;
  contaId: string;
  environment: string;
  status: string;
  planCode: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  trialWillEndNotifiedAt: Date | null;
  accessStatus: string;
  gracePeriodEndsAt: Date | null;
  restrictedAt: Date | null;
  canceledAt: Date | null;
  lastPaymentFailedAt: Date | null;
  firstPaidAt: Date | null;
  lastSuccessfulPaymentAt: Date | null;
  paymentMethodStatus: string;
  paymentMethodType: string | null;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  paymentMethodExpMonth: number | null;
  paymentMethodExpYear: number | null;
  restrictionReason: string | null;
  gracePeriodStartedAt: Date | null;
  accessStateVersion: number;
  lastProviderEventCreatedAt: Date | null;
  lastReconciledAt: Date | null;
  pendingPlanCode: string | null;
  pendingChangeType: string | null;
  pendingChangeEffectiveAt: Date | null;
}): PlatformBillingAccountRecord {
  return {
    id: account.id,
    contaId: account.contaId,
    environment: account.environment as PlatformBillingAccountRecord['environment'],
    status: account.status as PlatformBillingAccountRecord['status'],
    planCode: account.planCode as PlatformBillingAccountRecord['planCode'],
    stripeCustomerId: account.stripeCustomerId,
    stripeSubscriptionId: account.stripeSubscriptionId,
    stripePriceId: account.stripePriceId,
    currentPeriodEnd: account.currentPeriodEnd,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
    trialEndsAt: account.trialEndsAt,
    trialWillEndNotifiedAt: account.trialWillEndNotifiedAt,
    accessStatus: account.accessStatus as PlatformBillingAccountRecord['accessStatus'],
    gracePeriodEndsAt: account.gracePeriodEndsAt,
    restrictedAt: account.restrictedAt,
    canceledAt: account.canceledAt,
    lastPaymentFailedAt: account.lastPaymentFailedAt,
    firstPaidAt: account.firstPaidAt,
    lastSuccessfulPaymentAt: account.lastSuccessfulPaymentAt,
    paymentMethodStatus: account.paymentMethodStatus as PlatformBillingAccountRecord['paymentMethodStatus'],
    paymentMethodType: account.paymentMethodType,
    paymentMethodBrand: account.paymentMethodBrand,
    paymentMethodLast4: account.paymentMethodLast4,
    paymentMethodExpMonth: account.paymentMethodExpMonth,
    paymentMethodExpYear: account.paymentMethodExpYear,
    restrictionReason: account.restrictionReason as PlatformBillingAccountRecord['restrictionReason'],
    gracePeriodStartedAt: account.gracePeriodStartedAt,
    accessStateVersion: account.accessStateVersion,
    lastProviderEventCreatedAt: account.lastProviderEventCreatedAt,
    lastReconciledAt: account.lastReconciledAt,
    pendingPlanCode: account.pendingPlanCode as PlatformBillingAccountRecord['pendingPlanCode'],
    pendingChangeType: account.pendingChangeType as PlatformBillingAccountRecord['pendingChangeType'],
    pendingChangeEffectiveAt: account.pendingChangeEffectiveAt,
  };
}

function toCheckoutSessionRecord(session: {
  id: string;
  contaId: string;
  billingAccountId: string;
  environment: string;
  planCode: string;
  stripeCheckoutSessionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  status: string;
  url: string | null;
  idempotencyKey: string;
}): PlatformBillingCheckoutSessionRecord {
  return {
    id: session.id,
    contaId: session.contaId,
    billingAccountId: session.billingAccountId,
    environment: session.environment as PlatformBillingCheckoutSessionRecord['environment'],
    planCode: session.planCode as PlatformBillingCheckoutSessionRecord['planCode'],
    stripeCheckoutSessionId: session.stripeCheckoutSessionId,
    stripeCustomerId: session.stripeCustomerId,
    stripePriceId: session.stripePriceId,
    status: session.status as PlatformBillingCheckoutSessionRecord['status'],
    url: session.url,
    idempotencyKey: session.idempotencyKey,
  };
}

function toInvoiceRecord(invoice: {
  id: string;
  contaId: string;
  billingAccountId: string | null;
  environment: string;
  stripeInvoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  planCode: string | null;
  number: string | null;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  paidAt: Date | null;
  failedAt: Date | null;
  attempted: boolean;
  attemptCount: number;
  nextPaymentAttempt: Date | null;
  lastPaymentErrorCode: string | null;
  lastPaymentErrorMessage: string | null;
}): PlatformBillingInvoiceRecord {
  return {
    id: invoice.id,
    contaId: invoice.contaId,
    billingAccountId: invoice.billingAccountId,
    environment: invoice.environment as PlatformBillingInvoiceRecord['environment'],
    stripeInvoiceId: invoice.stripeInvoiceId,
    stripeCustomerId: invoice.stripeCustomerId,
    stripeSubscriptionId: invoice.stripeSubscriptionId,
    stripePriceId: invoice.stripePriceId,
    planCode: invoice.planCode as PlatformBillingInvoiceRecord['planCode'],
    number: invoice.number,
    status: invoice.status as PlatformBillingInvoiceRecord['status'],
    amountDue: invoice.amountDue,
    amountPaid: invoice.amountPaid,
    currency: invoice.currency,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    invoicePdf: invoice.invoicePdf,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    failedAt: invoice.failedAt,
    attempted: invoice.attempted,
    attemptCount: invoice.attemptCount,
    nextPaymentAttempt: invoice.nextPaymentAttempt,
    lastPaymentErrorCode: invoice.lastPaymentErrorCode,
    lastPaymentErrorMessage: invoice.lastPaymentErrorMessage,
  };
}

function toWebhookEventRecord(event: {
  id: string;
  environment: string;
  eventId: string;
  eventType: string;
  contaId: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  lastErrorCode: string | null;
  nextAttemptAt: Date | null;
  lockedAt: Date | null;
  lastAttemptAt: Date | null;
  processingTimeoutAt: Date | null;
  processedAt: Date | null;
  exhaustedAt: Date | null;
  workerId: string | null;
  correlationId: string | null;
}): PlatformBillingWebhookEventRecord {
  return {
    id: event.id,
    environment: event.environment as PlatformBillingWebhookEventRecord['environment'],
    eventId: event.eventId,
    eventType: event.eventType,
    contaId: event.contaId,
    status: event.status as PlatformBillingWebhookEventRecord['status'],
    attempts: event.attempts,
    lastError: event.lastError,
    lastErrorCode: event.lastErrorCode,
    nextAttemptAt: event.nextAttemptAt,
    lockedAt: event.lockedAt,
    lastAttemptAt: event.lastAttemptAt,
    processingTimeoutAt: event.processingTimeoutAt,
    processedAt: event.processedAt,
    exhaustedAt: event.exhaustedAt,
    workerId: event.workerId,
    correlationId: event.correlationId,
  };
}

function deriveAccessStatusFromStripeStatus(status: PlatformBillingAccountRecord['status']): PlatformBillingAccountRecord['accessStatus'] {
  if (status === 'ACTIVE' || status === 'TRIALING') return 'ACTIVE';
  if (status === 'PAST_DUE') return 'GRACE_PERIOD';
  if (status === 'UNPAID' || status === 'PAUSED') return 'RESTRICTED';
  if (status === 'CANCELED' || status === 'INCOMPLETE_EXPIRED') return 'CANCELED';
  return 'PENDING';
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function toPrismaJson(value: Record<string, unknown> | undefined): Prisma.InputJsonObject | undefined {
  return value as Prisma.InputJsonObject | undefined;
}

function runWithOptionalTransaction<T>(
  db: PlatformBillingPrismaClient,
  fn: (tx: PlatformBillingPrismaClientBase) => Promise<T>,
): Promise<T> {
  return db.$transaction ? db.$transaction(fn) : fn(db);
}

export type {
  AttachPlatformBillingCustomerInput,
  CreatePlatformBillingAccountInput,
  CreatePlatformBillingCheckoutSessionRecordInput,
  MarkPlatformBillingCheckoutPendingInput,
};
