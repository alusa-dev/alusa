import { z } from 'zod';

const resourceIdSchema = z.string().trim().min(1).max(191);
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use uma data no formato AAAA-MM-DD.')
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Informe uma data válida.');

export const billingChangeKindSchema = z.enum([
  'ADD_ALLOCATION',
  'REMOVE_ALLOCATION',
  'UPDATE_ALLOCATION',
  'TRANSFER_ALLOCATION',
  'PAUSE_ALLOCATION',
  'RESUME_ALLOCATION',
  'PAUSE_AGREEMENT',
  'RESUME_AGREEMENT',
  'CANCEL_AGREEMENT',
  'CHANGE_PAYER',
]);

/**
 * Vocabulário canônico compartilhado com o motor financeiro. A UI explica que
 * CURRENT_CYCLE alcança somente cobranças pendentes elegíveis.
 */
export const billingEffectivePolicySchema = z.enum([
  'CURRENT_CYCLE',
  'NEXT_CYCLE',
  'PRORATA',
]);

export const billingPayerSchema = z.object({
  type: z.enum(['RESPONSAVEL', 'ALUNO']),
  id: resourceIdSchema,
}).strict();

export const paidDecreaseHandlingSchema = z.enum(['CREDIT', 'REFUND', 'MANUAL_REVIEW']);

export const billingAllocationInputSchema = z
  .object({
    allocationId: resourceIdSchema.optional(),
    matriculaId: resourceIdSchema,
    kind: z.enum(['TUITION', 'ENROLLMENT_FEE', 'MATERIAL', 'ADJUSTMENT']).default('TUITION'),
    recurring: z.boolean().optional(),
    baseAmountCents: z.number().int().nonnegative(),
    discountAmountCents: z.number().int().nonnegative().default(0),
    validFrom: dateOnlySchema,
    validUntil: dateOnlySchema.nullable().optional(),
    description: z.string().trim().max(240).nullable().optional(),
  })
  .strict()
  .superRefine((allocation, context) => {
    if (allocation.discountAmountCents > allocation.baseAmountCents) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountAmountCents'],
        message: 'O desconto não pode superar o valor-base.',
      });
    }
    if (allocation.validUntil && allocation.validUntil <= allocation.validFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: 'A vigência final deve ser posterior à inicial.',
      });
    }
  });

const billingChangeBaseSchema = z.object({
  agreementId: resourceIdSchema,
  effectivePolicy: billingEffectivePolicySchema,
  effectiveDate: dateOnlySchema,
  reason: z.string().trim().min(3).max(500),
  paidDecreaseHandling: paidDecreaseHandlingSchema.default('CREDIT'),
}).strict();

const addAllocationSchema = billingChangeBaseSchema.extend({
  operation: z.literal('ADD_ALLOCATION'),
  allocations: z.array(billingAllocationInputSchema).min(1).max(100),
});

const removeAllocationSchema = billingChangeBaseSchema.extend({
  operation: z.literal('REMOVE_ALLOCATION'),
  allocationIds: z.array(resourceIdSchema).min(1).max(100),
});

const updateAllocationSchema = billingChangeBaseSchema
  .extend({
    operation: z.literal('UPDATE_ALLOCATION'),
    allocations: z.array(billingAllocationInputSchema).min(1).max(100),
  })
  .superRefine((change, context) => {
    change.allocations.forEach((allocation, index) => {
      if (!allocation.allocationId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allocations', index, 'allocationId'],
          message: 'Informe a alocação que será alterada.',
        });
      }
    });
  });

const transferAllocationSchema = billingChangeBaseSchema
  .extend({
    operation: z.literal('TRANSFER_ALLOCATION'),
    targetAgreementId: resourceIdSchema,
    allocationIds: z.array(resourceIdSchema).min(1).max(100),
  })
  .superRefine((change, context) => {
    if (change.targetAgreementId === change.agreementId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetAgreementId'],
        message: 'O acordo de destino deve ser diferente do acordo atual.',
      });
    }
  });

const cancelAgreementSchema = billingChangeBaseSchema.extend({
  operation: z.literal('CANCEL_AGREEMENT'),
});

const pauseAllocationSchema = billingChangeBaseSchema.extend({
  operation: z.literal('PAUSE_ALLOCATION'),
  allocationIds: z.array(resourceIdSchema).min(1).max(100),
});

const resumeAllocationSchema = billingChangeBaseSchema.extend({
  operation: z.literal('RESUME_ALLOCATION'),
  allocationIds: z.array(resourceIdSchema).min(1).max(100),
  nextDueDate: dateOnlySchema.optional(),
});

const pauseAgreementSchema = billingChangeBaseSchema.extend({
  operation: z.literal('PAUSE_AGREEMENT'),
});

const resumeAgreementSchema = billingChangeBaseSchema.extend({
  operation: z.literal('RESUME_AGREEMENT'),
  nextDueDate: dateOnlySchema.optional(),
});

const changePayerSchema = billingChangeBaseSchema.extend({
  operation: z.literal('CHANGE_PAYER'),
  newPayer: billingPayerSchema,
});

function validateChangeInvariants(
  change: {
    operation: string;
    effectiveDate: string;
    nextDueDate?: string;
    allocationIds?: string[];
    allocations?: Array<{ allocationId?: string; matriculaId: string }>;
  },
  context: z.RefinementCtx,
) {
  if (change.nextDueDate && change.nextDueDate < change.effectiveDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextDueDate'],
      message: 'O próximo vencimento não pode ser anterior à retomada.',
    });
  }

  if (change.allocationIds && new Set(change.allocationIds).size !== change.allocationIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allocationIds'],
      message: 'A mesma alocação não pode ser informada mais de uma vez.',
    });
  }

  if (change.operation === 'ADD_ALLOCATION' && change.allocations) {
    const enrollmentIds = change.allocations.map((allocation) => allocation.matriculaId);
    if (new Set(enrollmentIds).size !== enrollmentIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allocations'],
        message: 'A mesma matrícula não pode ser adicionada mais de uma vez.',
      });
    }
  }

  if (change.operation === 'UPDATE_ALLOCATION' && change.allocations) {
    const allocationIds = change.allocations
      .map((allocation) => allocation.allocationId)
      .filter((value): value is string => Boolean(value));
    if (new Set(allocationIds).size !== allocationIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allocations'],
        message: 'A mesma alocação não pode ser alterada mais de uma vez.',
      });
    }
  }
}

export const billingAgreementPreviewRequestSchema = z.union([
  addAllocationSchema,
  removeAllocationSchema,
  updateAllocationSchema,
  transferAllocationSchema,
  pauseAllocationSchema,
  resumeAllocationSchema,
  pauseAgreementSchema,
  resumeAgreementSchema,
  cancelAgreementSchema,
  changePayerSchema,
]).superRefine(validateChangeInvariants);

const billingCommitFields = {
  idempotencyKey: z.string().trim().min(8).max(191),
  previewHash: z.string().trim().min(16).max(512),
  expectedVersion: z.number().int().nonnegative(),
  previewExpiresAt: z.string().datetime(),
};

const updateAllocationCommitSchema = billingChangeBaseSchema
  .extend({
    operation: z.literal('UPDATE_ALLOCATION'),
    allocations: z.array(billingAllocationInputSchema).min(1).max(100),
    ...billingCommitFields,
  })
  .superRefine((change, context) => {
    change.allocations.forEach((allocation, index) => {
      if (!allocation.allocationId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allocations', index, 'allocationId'],
          message: 'Informe a alocação que será alterada.',
        });
      }
    });
  });

const transferAllocationCommitSchema = billingChangeBaseSchema
  .extend({
    operation: z.literal('TRANSFER_ALLOCATION'),
    targetAgreementId: resourceIdSchema,
    allocationIds: z.array(resourceIdSchema).min(1).max(100),
    ...billingCommitFields,
  })
  .superRefine((change, context) => {
    if (change.targetAgreementId === change.agreementId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetAgreementId'],
        message: 'O acordo de destino deve ser diferente do acordo atual.',
      });
    }
  });

export const billingAgreementCommitRequestSchema = z.union([
  addAllocationSchema.extend(billingCommitFields),
  removeAllocationSchema.extend(billingCommitFields),
  updateAllocationCommitSchema,
  transferAllocationCommitSchema,
  pauseAllocationSchema.extend(billingCommitFields),
  resumeAllocationSchema.extend(billingCommitFields),
  pauseAgreementSchema.extend(billingCommitFields),
  resumeAgreementSchema.extend(billingCommitFields),
  cancelAgreementSchema.extend(billingCommitFields),
  changePayerSchema.extend(billingCommitFields),
]).superRefine(validateChangeInvariants);

export const billingAgreementParamsSchema = z.object({
  id: resourceIdSchema,
});

export type BillingChangeKind = z.infer<typeof billingChangeKindSchema>;
export type BillingEffectivePolicy = z.infer<typeof billingEffectivePolicySchema>;
export type BillingPayer = z.infer<typeof billingPayerSchema>;
export type BillingAllocationInput = z.infer<typeof billingAllocationInputSchema>;
export type BillingAgreementPreviewRequest = z.infer<typeof billingAgreementPreviewRequestSchema>;
export type BillingAgreementCommitRequest = z.infer<typeof billingAgreementCommitRequestSchema>;
type WithoutChangeControls<T> = T extends BillingAgreementPreviewRequest
  ? Omit<T, 'agreementId' | 'effectivePolicy' | 'effectiveDate' | 'reason' | 'paidDecreaseHandling'>
  : never;
export type BillingAgreementChangeSeed = WithoutChangeControls<BillingAgreementPreviewRequest>;

export const billingMoneySummarySchema = z.object({
  currentCents: z.number().int().nonnegative(),
  addedCents: z.number().int().nonnegative(),
  removedCents: z.number().int().nonnegative(),
  resultingCents: z.number().int().nonnegative(),
});

export const billingAffectedPaymentSchema = z.object({
  id: resourceIdSchema,
  dueDate: dateOnlySchema,
  status: z.string().trim().min(1),
  currentAmountCents: z.number().int().nonnegative(),
  resultingAmountCents: z.number().int().nonnegative(),
  action: z.enum(['UNCHANGED', 'UPDATE', 'DELETE', 'CREDIT', 'COMPLEMENT', 'REFUND_REVIEW']),
});

export const billingPaidPaymentAdjustmentSchema = z.object({
  paymentId: resourceIdSchema,
  amountCents: z.number().int().nonnegative(),
  kind: z.enum(['CREDIT', 'COMPLEMENT', 'REFUND_REVIEW']),
  description: z.string(),
});

export const billingAgreementPreviewResponseSchema = z.object({
  agreementId: resourceIdSchema,
  operation: billingChangeKindSchema,
  effectivePolicy: billingEffectivePolicySchema,
  sourceVersion: z.number().int().nonnegative(),
  previewHash: z.string().min(16),
  expiresAt: z.string().datetime(),
  totals: billingMoneySummarySchema,
  affectedPendingPayments: z.array(billingAffectedPaymentSchema),
  paidPaymentAdjustments: z.array(billingPaidPaymentAdjustmentSchema),
  warnings: z.array(z.string()),
  blockers: z.array(z.string()),
  canCommit: z.boolean(),
});

export const billingAgreementOperationStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'APPLIED',
  'PARTIAL',
  'REQUIRES_RECONCILIATION',
  'FAILED',
  'CANCELLED',
]);

export const billingAgreementCommitResponseSchema = z.object({
  operationId: resourceIdSchema,
  agreementId: resourceIdSchema,
  status: billingAgreementOperationStatusSchema,
  acceptedAt: z.string().datetime(),
  message: z.string(),
});

export const billingAgreementAllocationViewSchema = z.object({
  id: resourceIdSchema,
  matriculaId: resourceIdSchema,
  alunoId: resourceIdSchema,
  alunoNome: z.string(),
  description: z.string(),
  netAmountCents: z.number().int().nonnegative(),
  status: z.enum(['SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELED']),
  validFrom: dateOnlySchema,
  validUntil: dateOnlySchema.nullable(),
});

export const billingAgreementOperationViewSchema = z.object({
  id: resourceIdSchema,
  kind: billingChangeKindSchema,
  status: billingAgreementOperationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  message: z.string().nullable(),
});

export const billingAgreementViewSchema = z.object({
  id: resourceIdSchema,
  status: z.string().trim().min(1),
  version: z.number().int().nonnegative(),
  payer: billingPayerSchema.extend({ name: z.string() }),
  billingType: z.string(),
  cycle: z.string(),
  dueDay: z.number().int().min(1).max(31).nullable(),
  desiredValueCents: z.number().int().nonnegative(),
  confirmedValueCents: z.number().int().nonnegative(),
  reconciliationStatus: z.enum(['CONSISTENT', 'PENDING', 'DIVERGENT', 'RESULT_UNKNOWN']),
  allocations: z.array(billingAgreementAllocationViewSchema),
  affectedPayments: z.array(billingAffectedPaymentSchema),
  recentOperations: z.array(billingAgreementOperationViewSchema),
  updatedAt: z.string().datetime(),
});

export type BillingMoneySummary = z.infer<typeof billingMoneySummarySchema>;
export type BillingAffectedPayment = z.infer<typeof billingAffectedPaymentSchema>;
export type BillingPaidPaymentAdjustment = z.infer<typeof billingPaidPaymentAdjustmentSchema>;
export type BillingAgreementPreviewResponse = z.infer<typeof billingAgreementPreviewResponseSchema>;
export type BillingAgreementOperationStatus = z.infer<typeof billingAgreementOperationStatusSchema>;
export type BillingAgreementCommitResponse = z.infer<typeof billingAgreementCommitResponseSchema>;
export type BillingAgreementAllocationView = z.infer<typeof billingAgreementAllocationViewSchema>;
export type BillingAgreementOperationView = z.infer<typeof billingAgreementOperationViewSchema>;
export type BillingAgreementView = z.infer<typeof billingAgreementViewSchema>;

export type BillingAgreementApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
