import { z } from 'zod';

export const anticipationStatusSchema = z.enum([
  'PENDING',
  'DENIED',
  'CREDITED',
  'DEBITED',
  'CANCELLED',
  'OVERDUE',
  'SCHEDULED',
]);

export const anticipationTargetTypeSchema = z.enum(['PAYMENT', 'INSTALLMENT']);

export const listAnticipationsQueryDTOSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: anticipationStatusSchema.optional(),
  payment: z.string().min(1).optional(),
  installment: z.string().min(1).optional(),
});

export type ListAnticipationsQueryDTO = z.infer<typeof listAnticipationsQueryDTOSchema>;

export const listAnticipationCandidatesQueryDTOSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  billingType: z.enum(['ALL', 'CREDIT_CARD', 'BOLETO', 'PIX']).default('ALL'),
  search: z.string().trim().max(120).optional(),
});

export type ListAnticipationCandidatesQueryDTO = z.infer<
  typeof listAnticipationCandidatesQueryDTOSchema
>;

export const anticipationTargetInputDTOSchema = z
  .object({
    targetType: anticipationTargetTypeSchema,
    payment: z.string().min(1).optional(),
    installment: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetType === 'PAYMENT' && !value.payment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
      path: ['payment'],
      message: 'payment obrigatório para antecipar uma cobrança',
      });
    }
    if (value.targetType === 'INSTALLMENT' && !value.installment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['installment'],
        message: 'installment obrigatório para antecipar um parcelamento',
      });
    }
  });

export type AnticipationTargetInputDTO = z.infer<typeof anticipationTargetInputDTOSchema>;

export const updateAnticipationConfigurationInputDTOSchema = z.object({
  creditCardAutomaticEnabled: z.boolean(),
});

export type UpdateAnticipationConfigurationInputDTO = z.infer<
  typeof updateAnticipationConfigurationInputDTOSchema
>;
