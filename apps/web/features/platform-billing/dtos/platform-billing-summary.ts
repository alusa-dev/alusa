import { z } from 'zod';

const planCodeSchema = z.enum(['STARTER', 'PREMIUM', 'PRO', 'CUSTOM']);
const publicPlanCodeSchema = z.enum(['STARTER', 'PREMIUM', 'PRO']);

export const publicPlatformPlanDTOSchema = z.object({
  code: publicPlanCodeSchema,
  name: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  currency: z.literal('brl'),
  interval: z.literal('month'),
  trialDays: z.number().int().positive(),
  maxActiveStudents: z.number().int().positive(),
  publicCheckoutEnabled: z.literal(true),
  includedFeatures: z.array(z.string().min(1)),
});

const billingAccountSchema = z.object({
  id: z.string().min(1),
  status: z.enum([
    'NOT_STARTED',
    'CHECKOUT_PENDING',
    'ACTIVE',
    'TRIALING',
    'PAST_DUE',
    'CANCELED',
    'INCOMPLETE',
    'INCOMPLETE_EXPIRED',
    'UNPAID',
    'PAUSED',
    'UNKNOWN',
  ]),
  accessStatus: z.enum(['PENDING', 'ACTIVE', 'GRACE_PERIOD', 'RESTRICTED', 'CANCELED']),
  planCode: planCodeSchema.nullable(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  currentPeriodEnd: z.string().datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  trialEndsAt: z.string().datetime().nullable(),
  trialWillEndNotifiedAt: z.string().datetime().nullable(),
  gracePeriodEndsAt: z.string().datetime().nullable(),
  restrictedAt: z.string().datetime().nullable(),
  canceledAt: z.string().datetime().nullable(),
  lastPaymentFailedAt: z.string().datetime().nullable(),
  lastReconciledAt: z.string().datetime().nullable(),
  pendingPlanCode: planCodeSchema.nullable(),
  pendingChangeType: z
    .enum(['UPGRADE', 'DOWNGRADE', 'CANCEL_AT_PERIOD_END', 'UNDO_CANCEL', 'REACTIVATE', 'PAYMENT_RECOVERY'])
    .nullable(),
  pendingChangeEffectiveAt: z.string().datetime().nullable(),
});

const billingInvoiceSchema = z.object({
  id: z.string().min(1),
  stripeInvoiceId: z.string().min(1),
  planCode: planCodeSchema.nullable(),
  number: z.string().nullable(),
  status: z.enum(['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE', 'UNKNOWN']),
  amountPaid: z.number().int(),
  amountDue: z.number().int(),
  currency: z.string().min(1),
  hostedInvoiceUrl: z.string().nullable(),
  invoicePdf: z.string().nullable(),
  periodStart: z.string().datetime().nullable(),
  periodEnd: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  attempted: z.boolean(),
  attemptCount: z.number().int().nonnegative(),
  nextPaymentAttempt: z.string().datetime().nullable(),
  lastPaymentErrorCode: z.string().nullable(),
  lastPaymentErrorMessage: z.string().nullable(),
});

const paymentMethodSummarySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('present'),
    type: z.literal('card'),
    brand: z.string().nullable(),
    last4: z.string().min(1),
    expMonth: z.number().int().nullable(),
    expYear: z.number().int().nullable(),
  }),
  z.object({ status: z.literal('missing') }),
  z.object({ status: z.literal('unknown') }),
]);

export const platformBillingSummaryDTOSchema = z.object({
  environment: z.enum(['TEST', 'LIVE']),
  canManage: z.boolean(),
  billingInfo: z.object({
    contaName: z.string().min(1),
    email: z.string().email().nullable(),
  }),
  activeStudents: z.number().int().nonnegative(),
  account: billingAccountSchema.nullable(),
  paymentMethod: paymentMethodSummarySchema,
  plans: z.array(publicPlatformPlanDTOSchema).min(1),
  invoices: z.array(billingInvoiceSchema),
  health: z.object({
    contaId: z.string().min(1),
    stripeCustomerId: z.string().nullable(),
    stripeSubscriptionId: z.string().nullable(),
    lastWebhook: z
      .object({
        id: z.string().min(1),
        eventId: z.string().min(1),
        eventType: z.string().min(1),
        status: z.string().min(1),
        receivedAt: z.string().datetime(),
        processedAt: z.string().datetime().nullable(),
        lastErrorCode: z.string().nullable(),
      })
      .nullable(),
    webhookStats: z.record(z.number().int().nonnegative()),
    lastReconciliation: z.string().datetime().nullable(),
    pendingChanges: z.number().int().nonnegative(),
    openIssues: z.number().int().nonnegative(),
  }),
  planChanges: z.array(
    z.object({
      id: z.string().min(1),
      type: z.enum(['UPGRADE', 'DOWNGRADE', 'CANCEL_AT_PERIOD_END', 'UNDO_CANCEL', 'REACTIVATE', 'PAYMENT_RECOVERY']),
      status: z.enum(['PENDING_PAYMENT', 'PENDING_EFFECTIVE_DATE', 'APPLIED', 'CANCELED', 'FAILED', 'SUPERSEDED']),
      fromPlanCode: planCodeSchema.nullable(),
      toPlanCode: planCodeSchema.nullable(),
      effectiveAt: z.string().datetime().nullable(),
      requestedAt: z.string().datetime(),
      lastError: z.string().nullable(),
    }),
  ),
  issues: z.array(
    z.object({
      id: z.string().min(1),
      severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
      code: z.string().min(1),
      title: z.string().min(1),
      message: z.string().min(1),
      detectedAt: z.string().datetime(),
    }),
  ),
});

export type PlatformBillingSummaryDTO = z.infer<typeof platformBillingSummaryDTOSchema>;
export type PublicPlatformPlanDTO = z.infer<typeof publicPlatformPlanDTOSchema>;
