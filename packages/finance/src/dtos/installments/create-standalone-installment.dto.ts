import { z } from 'zod';

const moneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Formato invalido. Use ex: "150.00"')
  .refine((v) => parseFloat(v) > 0, 'Valor deve ser maior que zero');
const moneyNumberSchema = z.coerce.number().positive('Valor deve ser maior que zero');

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data invalido. Use YYYY-MM-DD');

const payerSchema = z.union([
  z.object({ type: z.literal('aluno'), alunoId: z.string().min(1) }),
  z.object({ type: z.literal('responsavel'), responsavelId: z.string().min(1) }),
]);

export const createStandaloneInstallmentDTOSchema = z
  .object({
    payer: payerSchema,
    value: moneyNumberSchema.optional(),
    amount: moneyStringSchema.optional(), // compat legado (1 ciclo)
    firstDueDate: isoDateSchema,
    billingType: z.enum(['BOLETO', 'PIX', 'CREDIT_CARD', 'UNDEFINED']),
    installmentCount: z
      .number()
      .int('installmentCount deve ser inteiro')
      .min(2, 'installmentCount deve ser >= 2')
      .max(60, 'installmentCount deve ser <= 60'),
    description: z.string().max(500).optional(),
    discount: z
      .object({
        value: z.number().nonnegative(),
        dueDateLimitDays: z.number().int().nonnegative().optional(),
        type: z.enum(['FIXED', 'PERCENTAGE']).optional(),
      })
      .optional(),
    interest: z
      .object({
        value: z.number().nonnegative(),
      })
      .optional(),
    fine: z
      .object({
        value: z.number().nonnegative(),
        type: z.enum(['FIXED', 'PERCENTAGE']).optional(),
      })
      .optional(),
    uiRequestId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.value == null && !data.amount) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'value é obrigatório',
      });
    }
    if (data.billingType === 'UNDEFINED') {
      ctx.addIssue({
        code: 'custom',
        path: ['billingType'],
        message: 'billingType inválido para parcelamento',
      });
    }
  });

export type CreateStandaloneInstallmentDTO = z.infer<typeof createStandaloneInstallmentDTOSchema>;
