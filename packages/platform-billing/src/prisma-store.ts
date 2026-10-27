import { Prisma } from '@prisma/client';
import { PlatformBillingError } from './errors';
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
  | 'conta'
  | '$queryRaw'
  | '$executeRaw'
>;

type PlatformBillingPrismaClient = PlatformBillingPrismaClientBase & {
  $transaction?<T>(
    fn: (tx: PlatformBillingPrismaClientBase) => Promise<T>,
  ): Promise<T>;
};

export function createPrismaPlatformBillingStore(db: PlatformBillingPrismaClient): PlatformBillingStore {
  return {
    contaExists: async (input) => Boolean(await db.conta.findUnique({ where: { id: input.contaId }, select: { id: true } })),

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

    reserveTrialSubscriptionClaim: async (input) => {
      const now = new Date();
      const staleClaimBefore = new Date(now.getTime() - 5 * 60_000);
      await db.platformBillingAccount.upsert({
        where: {
          uq_platform_billing_account_conta_env: {
            contaId: input.contaId,
            environment: input.environment,
          },
        },
        create: {
          contaId: input.contaId,
          environment: input.environment,
          status: 'NOT_STARTED',
          accessStatus: 'PENDING',
          trialSubscriptionClaimKey: input.idempotencyKey,
          trialSubscriptionClaimPhase: 'CLAIMED',
          trialSubscriptionClaimedAt: now,
        },
        update: {},
      });

      const claimed = await db.platformBillingAccount.updateMany({
        where: {
          contaId: input.contaId,
          environment: input.environment,
          stripeSubscriptionId: null,
          trialEndsAt: null,
          checkoutClaimKey: null,
          OR: [
            { trialSubscriptionClaimKey: null },
            {
              trialSubscriptionClaimPhase: 'CLAIMED',
              trialSubscriptionClaimedAt: { lt: staleClaimBefore },
            },
          ],
        },
        data: {
          trialSubscriptionClaimKey: input.idempotencyKey,
          trialSubscriptionClaimPhase: 'CLAIMED',
          trialSubscriptionClaimedAt: now,
          trialSubscriptionRequestExpiresAt: null,
        },
      });
      const current = await db.platformBillingAccount.findUniqueOrThrow({
        where: {
          uq_platform_billing_account_conta_env: {
            contaId: input.contaId,
            environment: input.environment,
          },
        },
      });
      if (claimed.count === 1) return toAccountRecord(current);
      if (current.stripeSubscriptionId || current.trialEndsAt) return toAccountRecord(current);
      if (current.trialSubscriptionClaimKey === input.idempotencyKey) {
        if (current.trialSubscriptionClaimPhase === 'CLAIMED') return toAccountRecord(current);
        if (
          current.trialSubscriptionClaimPhase === 'REQUESTING'
          && current.trialSubscriptionRequestExpiresAt instanceof Date
          && current.trialSubscriptionRequestExpiresAt > now
        ) return toAccountRecord(current);
        throw new PlatformBillingError(
          'Trial subscription request may have reached Stripe; retry with the same key within the recovery window or reconcile manually.',
          'PLATFORM_BILLING_RECONCILIATION_FAILED',
          { contaId: input.contaId, environment: input.environment },
        );
      }
      throw new PlatformBillingError(
        current.trialSubscriptionClaimPhase === 'REQUESTING'
          ? 'A trial subscription request is already in progress or requires reconciliation.'
          : 'A trial subscription is already being created for this account.',
        current.trialSubscriptionClaimPhase === 'REQUESTING'
          ? 'PLATFORM_BILLING_RECONCILIATION_FAILED'
          : 'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT',
        { contaId: input.contaId, environment: input.environment },
      );
    },

    markTrialSubscriptionRequestStarted: async (input) => {
      const now = new Date();
      const requestExpiresAt = new Date(now.getTime() + 20 * 60 * 60_000);
      const changed = await db.platformBillingAccount.updateMany({
        where: {
          contaId: input.contaId,
          environment: input.environment,
          trialSubscriptionClaimKey: input.idempotencyKey,
          trialSubscriptionClaimPhase: 'CLAIMED',
        },
        data: {
          trialSubscriptionClaimPhase: 'REQUESTING',
          trialSubscriptionRequestExpiresAt: requestExpiresAt,
        },
      });
      if (changed.count === 1) return;
      const current = await db.platformBillingAccount.findUniqueOrThrow({
        where: {
          uq_platform_billing_account_conta_env: {
            contaId: input.contaId,
            environment: input.environment,
          },
        },
      });
      if (
        current.trialSubscriptionClaimKey === input.idempotencyKey
        && current.trialSubscriptionClaimPhase === 'REQUESTING'
        && current.trialSubscriptionRequestExpiresAt instanceof Date
        && current.trialSubscriptionRequestExpiresAt > now
      ) return;
      throw new PlatformBillingError(
        'Trial subscription claim expired or changed before the Stripe request started.',
        'PLATFORM_BILLING_RECONCILIATION_FAILED',
        { contaId: input.contaId, environment: input.environment },
      );
    },

    releaseTrialSubscriptionClaim: async (input) => {
      await db.platformBillingAccount.updateMany({
        where: {
          contaId: input.contaId,
          environment: input.environment,
          trialSubscriptionClaimKey: input.idempotencyKey,
        },
        data: {
          trialSubscriptionClaimKey: null,
          trialSubscriptionClaimPhase: null,
          trialSubscriptionClaimedAt: null,
          trialSubscriptionRequestExpiresAt: null,
        },
      });
    },

    markCheckoutPending: async (input) => {
      // Keep the last known access state while Checkout is open. Repeated or
      // abandoned Checkout attempts must not revoke an existing subscription.
      const now = new Date();
      const claim = await db.platformBillingAccount.updateMany({
        where: {
          id: input.accountId,
          trialSubscriptionClaimKey: null,
          AND: [
            { OR: [
              { stripeSubscriptionId: null },
              { status: { in: ['CANCELED', 'INCOMPLETE_EXPIRED'] } },
              ...(input.pendingChangeType === 'REACTIVATE'
                ? [
                    { status: 'PAUSED' as const, trialEndsAt: { lte: now }, firstPaidAt: null, lastSuccessfulPaymentAt: null },
                    { status: 'TRIALING' as const, trialEndsAt: { lte: now }, firstPaidAt: null, lastSuccessfulPaymentAt: null },
                  ]
                : []),
            ] },
            { OR: [
              { checkoutClaimKey: null },
              { checkoutClaimPhase: 'CLAIMED', checkoutClaimedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
            ] },
          ],
          status: {
            notIn: input.pendingChangeType === 'REACTIVATE'
              ? ['ACTIVE', 'PAST_DUE', 'UNPAID']
              : ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'PAUSED'],
          },
        },
        data: {
          status: input.pendingChangeType === 'REACTIVATE' ? 'CANCELED' : 'CHECKOUT_PENDING',
          pendingPlanCode: input.planCode,
          pendingChangeType: input.pendingChangeType ?? null,
          pendingChangeEffectiveAt: null,
          checkoutClaimKey: input.idempotencyKey,
          checkoutClaimPhase: 'CLAIMED',
          checkoutClaimedAt: now,
          checkoutRequestExpiresAt: null,
        },
      });
      if (claim.count === 0) {
        const current = await db.platformBillingAccount.findUniqueOrThrow({ where: { id: input.accountId } });
        if (current.checkoutClaimKey === input.idempotencyKey
          && current.checkoutClaimPhase === 'REQUESTING'
          && current.checkoutRequestExpiresAt instanceof Date
          && current.checkoutRequestExpiresAt > now) {
          return toAccountRecord(current);
        }
        const hasBlockingSubscription = current.stripeSubscriptionId !== null && (
          input.pendingChangeType === 'REACTIVATE'
            ? ['ACTIVE', 'PAST_DUE', 'UNPAID'].includes(current.status)
            : ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'PAUSED'].includes(current.status)
        );
        throw new PlatformBillingError(
          hasBlockingSubscription ? 'An active platform billing subscription already exists.' : current.checkoutClaimPhase === 'REQUESTING'
            ? 'Checkout claim expired after the Stripe request may have started; reconcile Stripe before retrying with a new key.'
            : 'A Checkout session is already being created for this account.',
          hasBlockingSubscription ? 'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS' : current.checkoutClaimPhase === 'REQUESTING'
            ? 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED' : 'PLATFORM_BILLING_CHECKOUT_IN_PROGRESS',
        );
      }
      const account = await db.platformBillingAccount.findUniqueOrThrow({
        where: { id: input.accountId },
      });

      return toAccountRecord(account);
    },

    markCheckoutRequestStarted: async ({ accountId, idempotencyKey }) => {
      const now = new Date();
      const requestExpiresAt = new Date(now.getTime() + 20 * 60 * 60_000);
      const changed = await db.platformBillingAccount.updateMany({
        where: { id: accountId, checkoutClaimKey: idempotencyKey, checkoutClaimPhase: 'CLAIMED' },
        data: { checkoutClaimPhase: 'REQUESTING', checkoutRequestExpiresAt: requestExpiresAt },
      });
      if (changed.count === 1) return;
      const current = await db.platformBillingAccount.findUniqueOrThrow({ where: { id: accountId } });
      if (current.checkoutClaimKey === idempotencyKey
        && current.checkoutClaimPhase === 'REQUESTING'
        && current.checkoutRequestExpiresAt instanceof Date
        && current.checkoutRequestExpiresAt > now) return;
      throw new PlatformBillingError(
        'Checkout claim expired after the Stripe request may have started; reconcile Stripe before retrying.',
        'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED',
      );
    },

    bindCheckoutSubscription: async (input) => {
      // Bind the provider resource as soon as Checkout completes so the
      // reconciliation job can recover even if the subscription webhook is
      // delayed or lost. This deliberately does not change status/access.
      await db.platformBillingAccount.updateMany({
        where: {
          id: input.accountId,
          contaId: input.contaId,
          environment: input.environment,
          stripeCustomerId: input.stripeCustomerId,
          checkoutClaimKey: input.idempotencyKey,
        },
        data: {
          stripeSubscriptionId: input.stripeSubscriptionId,
          checkoutClaimKey: null,
          checkoutClaimPhase: null,
          checkoutClaimedAt: null,
          checkoutRequestExpiresAt: null,
        },
      });
    },

    clearCheckoutClaim: async ({ contaId, environment, idempotencyKey }) => {
      await db.platformBillingAccount.updateMany({
        where: { contaId, environment, checkoutClaimKey: idempotencyKey, status: 'CHECKOUT_PENDING' },
        data: { status: 'NOT_STARTED', accessStatus: 'PENDING' },
      });
      const cleared = await db.platformBillingAccount.updateMany({
        where: { contaId, environment, checkoutClaimKey: idempotencyKey },
        data: {
          checkoutClaimKey: null,
          checkoutClaimPhase: null,
          checkoutClaimedAt: null,
          checkoutRequestExpiresAt: null,
          pendingPlanCode: null,
          pendingChangeType: null,
          pendingChangeEffectiveAt: null,
        },
      });
      return cleared.count > 0;
    },

    markCheckoutSessionExpired: async ({ contaId, environment, idempotencyKey }) => {
      await db.platformBillingCheckoutSession.updateMany({
        where: { contaId, environment, idempotencyKey, status: 'CREATED' },
        data: { status: 'EXPIRED' },
      });
    },

    markCheckoutSessionCompleted: async ({ contaId, environment, stripeCheckoutSessionId }) => {
      await db.platformBillingCheckoutSession.updateMany({
        where: {
          contaId,
          environment,
          stripeCheckoutSessionId,
          status: { in: ['CREATED', 'COMPLETED'] },
        },
        data: { status: 'COMPLETED' },
      });
    },

    updateAccountFromStripeSubscription: async (input) => {
      const now = new Date();
      const account = await runWithOptionalTransaction(db, async (tx) => {
        if (input.webhookLease) {
          const lease = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "PlatformBillingWebhookEvent"
            WHERE "id" = ${input.webhookLease.id}
              AND "workerId" = ${input.webhookLease.workerId}
              AND "status" = 'PROCESSING'::"PlatformBillingWebhookEventStatus"
            FOR UPDATE
          `;
          if (lease.length !== 1) throw new Error('Stripe webhook lease was lost before billing state mutation.');
        }
        const current = await tx.platformBillingAccount.findUniqueOrThrow({
          where: { id: input.accountId },
        });
        if (
          input.lastProviderEventCreatedAt
          && current.lastProviderEventCreatedAt
          && current.lastProviderEventCreatedAt.getTime() > input.lastProviderEventCreatedAt.getTime()
        ) {
          return current;
        }

        const accountUpdate = {
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
            ...(input.pendingChangeOperationId !== undefined
              ? {
                  pendingChangeOperationId: input.pendingChangeOperationId,
                  pendingChangeClaimToken: null,
                  pendingChangeClaimedAt: null,
                }
              : {}),
            lastStripeEventId: input.lastStripeEventId,
            ...(input.stripeSubscriptionId ? {
              checkoutClaimKey: null,
              checkoutClaimPhase: null,
              checkoutClaimedAt: null,
              checkoutRequestExpiresAt: null,
              trialSubscriptionClaimKey: null,
              trialSubscriptionClaimPhase: null,
              trialSubscriptionClaimedAt: null,
              trialSubscriptionRequestExpiresAt: null,
            } : {}),
            ...(input.accessStatus && input.accessStatus !== current.accessStatus
              ? { accessStateVersion: { increment: 1 } }
              : {}),
          };
        if (input.expectedAccountSnapshot) {
          const snapshot = input.expectedAccountSnapshot;
          const changed = await tx.platformBillingAccount.updateMany({
            where: {
              id: input.accountId,
              contaId: snapshot.contaId,
              environment: snapshot.environment,
              stripeSubscriptionId: snapshot.stripeSubscriptionId,
              pendingChangeOperationId: snapshot.pendingChangeOperationId,
              pendingChangeClaimToken: snapshot.pendingChangeClaimToken,
              ...(snapshot.trialSubscriptionClaimKey !== undefined
                ? { trialSubscriptionClaimKey: snapshot.trialSubscriptionClaimKey }
                : {}),
              ...(snapshot.lastProviderEventCreatedAt !== undefined
                ? { lastProviderEventCreatedAt: snapshot.lastProviderEventCreatedAt }
                : {}),
              ...(snapshot.lastStripeEventId !== undefined
                ? { lastStripeEventId: snapshot.lastStripeEventId }
                : {}),
            },
            data: accountUpdate,
          });
          if (changed.count !== 1) {
            throw new Error('Stripe account snapshot changed before subscription state could be applied.');
          }
        } else {
          await tx.platformBillingAccount.update({
            where: { id: input.accountId },
            data: accountUpdate,
          });
        }

        if (input.planChangeFinalization) {
          const finalization = input.planChangeFinalization;
          const finalized = await tx.platformBillingPlanChange.updateMany({
            where: {
              id: finalization.planChangeId,
              contaId: finalization.contaId,
              billingAccountId: finalization.billingAccountId,
              environment: finalization.environment,
              stripeSubscriptionId: finalization.stripeSubscriptionId,
              stripePriceId: finalization.stripePriceId,
              toPlanCode: finalization.toPlanCode,
              type: finalization.type,
              status: finalization.type === 'UPGRADE'
                ? { in: ['PENDING_PAYMENT', 'PENDING_EFFECTIVE_DATE'] }
                : 'PENDING_EFFECTIVE_DATE',
            },
            data: finalization.applied
              ? { status: 'APPLIED', appliedAt: now, lastError: null, stripePriceId: finalization.stripePriceId }
              : { status: 'FAILED', failedAt: now, lastError: 'Stripe pending update expired before payment.' },
          });
          if (finalized.count !== 1) {
            throw new Error('Stripe plan-change operation could not be finalized; account update was rolled back.');
          }
        }

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
      return runWithOptionalTransaction(db, async (tx) => {
        const invoiceKey = `${input.environment}:${input.stripeInvoiceId}`;
        await tx.$queryRaw`SELECT 1 AS "locked"
          FROM (SELECT pg_advisory_xact_lock(hashtextextended(${invoiceKey}, 0))) AS "invoice_lock"`;
        const uniqueWhere = {
          uq_platform_billing_invoice_env_invoice: {
            environment: input.environment,
            stripeInvoiceId: input.stripeInvoiceId,
          },
        };
        const existingInvoice = await tx.platformBillingInvoice.findUnique({ where: uniqueWhere });
        if (existingInvoice && existingInvoice.contaId !== input.contaId) {
          throw new PlatformBillingError(
            'Stripe invoice is already bound to a different Conta.',
            'PLATFORM_BILLING_WEBHOOK_INVALID',
            { stripeInvoiceId: input.stripeInvoiceId },
          );
        }

        const preservePaid = existingInvoice?.status === 'PAID';
        const amountPaid = preservePaid
          ? Math.max(existingInvoice.amountPaid, input.amountPaid)
          : input.amountPaid;
        const data = {
          billingAccountId: input.billingAccountId,
          stripeCustomerId: input.stripeCustomerId,
          stripeSubscriptionId: input.stripeSubscriptionId,
          stripePriceId: input.stripePriceId,
          planCode: input.planCode,
          number: input.number,
          status: preservePaid ? 'PAID' as const : input.status,
          amountDue: input.amountDue,
          amountPaid,
          currency: input.currency,
          hostedInvoiceUrl: input.hostedInvoiceUrl,
          invoicePdf: input.invoicePdf,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          dueDate: input.dueDate,
          paidAt: preservePaid ? existingInvoice.paidAt ?? input.paidAt : input.paidAt,
          failedAt: preservePaid ? null : input.failedAt,
          attempted: input.attempted,
          attemptCount: input.attemptCount,
          nextPaymentAttempt: preservePaid ? null : input.nextPaymentAttempt,
          lastPaymentErrorCode: preservePaid ? null : input.lastPaymentErrorCode,
          lastPaymentErrorMessage: preservePaid ? null : input.lastPaymentErrorMessage,
          raw: toPrismaJson(input.raw),
          lastStripeEventId: input.lastStripeEventId,
        };

        if (!existingInvoice) {
          const invoice = await tx.platformBillingInvoice.create({
            data: {
              contaId: input.contaId,
              environment: input.environment,
              stripeInvoiceId: input.stripeInvoiceId,
              ...data,
            },
          });
          return toInvoiceRecord(invoice);
        }

        const changed = await tx.platformBillingInvoice.updateMany({
          where: {
            id: existingInvoice.id,
            contaId: input.contaId,
            environment: input.environment,
            stripeInvoiceId: input.stripeInvoiceId,
            status: existingInvoice.status,
            amountPaid: existingInvoice.amountPaid,
            paidAt: existingInvoice.paidAt,
            lastStripeEventId: existingInvoice.lastStripeEventId,
          },
          data,
        });
        if (changed.count !== 1) throw new Error('Stripe invoice changed during webhook persistence; retry the event.');
        const invoice = await tx.platformBillingInvoice.findUniqueOrThrow({ where: { id: existingInvoice.id } });
        return toInvoiceRecord(invoice);
      });
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
      const updated = await db.platformBillingWebhookEvent.updateMany({
        where: { id: input.id, ...(input.workerId ? { workerId: input.workerId, status: 'PROCESSING' } : {}) },
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
      if (updated.count !== 1) throw new Error('Stripe webhook lease was lost before completion.');
      const record = await db.platformBillingWebhookEvent.findUniqueOrThrow({ where: { id: input.id } });
      return toWebhookEventRecord(record);
    },

    markWebhookEventIgnored: async (input) => {
      const updated = await db.platformBillingWebhookEvent.updateMany({
        where: { id: input.id, ...(input.workerId ? { workerId: input.workerId, status: 'PROCESSING' } : {}) },
        data: {
          status: 'IGNORED',
          contaId: input.contaId,
          processedAt: new Date(),
          lockedAt: null,
          processingTimeoutAt: null,
          workerId: null,
        },
      });
      if (updated.count !== 1) throw new Error('Stripe webhook lease was lost before completion.');
      const record = await db.platformBillingWebhookEvent.findUniqueOrThrow({ where: { id: input.id } });
      return toWebhookEventRecord(record);
    },

    markWebhookEventFailed: async (input) => {
      const updated = await db.platformBillingWebhookEvent.updateMany({
        where: { id: input.id, ...(input.workerId ? { workerId: input.workerId, status: 'PROCESSING' } : {}) },
        data: {
          status: input.exhausted ? 'EXHAUSTED' : 'FAILED',
          contaId: input.contaId,
          lockedAt: null,
          processingTimeoutAt: null,
          workerId: null,
          lastError: input.error.slice(0, 1000),
          lastErrorCode: input.errorCode,
          exhaustedAt: input.exhausted ? new Date() : null,
          ...(!input.exhausted && input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
        },
      });
      if (updated.count !== 1) throw new Error('Stripe webhook lease was lost before failure finalization.');
      const record = await db.platformBillingWebhookEvent.findUniqueOrThrow({ where: { id: input.id } });
      return toWebhookEventRecord(record);
    },

    createAuditLog: async (input) => {
      await db.platformBillingAuditLog.createMany({
        data: [{
          contaId: input.contaId,
          billingAccountId: input.billingAccountId,
          actorUserId: input.actorUserId,
          action: input.action,
          webhookEnvironment: input.webhookEnvironment,
          webhookEventId: input.webhookEventId,
          entityType: input.entityType,
          entityId: input.entityId,
          correlationId: input.correlationId,
          metadata: toPrismaJson(input.metadata),
        }],
        skipDuplicates: true,
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
  lastStripeEventId?: string | null;
  lastReconciledAt: Date | null;
  pendingPlanCode: string | null;
  pendingChangeType: string | null;
  pendingChangeEffectiveAt: Date | null;
  pendingChangeOperationId: string | null;
  pendingChangeClaimToken: string | null;
  trialSubscriptionClaimKey?: string | null;
  trialSubscriptionClaimPhase?: string | null;
  trialSubscriptionClaimedAt?: Date | null;
  trialSubscriptionRequestExpiresAt?: Date | null;
  checkoutClaimKey?: string | null;
  checkoutClaimPhase?: string | null;
  checkoutClaimedAt?: Date | null;
  checkoutRequestExpiresAt?: Date | null;
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
    lastStripeEventId: account.lastStripeEventId ?? null,
    lastReconciledAt: account.lastReconciledAt,
    checkoutClaimKey: account.checkoutClaimKey ?? null,
    checkoutClaimPhase: account.checkoutClaimPhase ?? null,
    checkoutClaimedAt: account.checkoutClaimedAt ?? null,
    checkoutRequestExpiresAt: account.checkoutRequestExpiresAt ?? null,
    pendingPlanCode: account.pendingPlanCode as PlatformBillingAccountRecord['pendingPlanCode'],
    pendingChangeType: account.pendingChangeType as PlatformBillingAccountRecord['pendingChangeType'],
    pendingChangeEffectiveAt: account.pendingChangeEffectiveAt,
    pendingChangeOperationId: account.pendingChangeOperationId,
    pendingChangeClaimToken: account.pendingChangeClaimToken,
    trialSubscriptionClaimKey: account.trialSubscriptionClaimKey ?? null,
    trialSubscriptionClaimPhase: account.trialSubscriptionClaimPhase ?? null,
    trialSubscriptionClaimedAt: account.trialSubscriptionClaimedAt ?? null,
    trialSubscriptionRequestExpiresAt: account.trialSubscriptionRequestExpiresAt ?? null,
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
  cancelUrl: string;
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
    cancelUrl: session.cancelUrl,
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
