import { z } from 'zod';

/**
 * DTO de entrada para criação de parcelamento/carnê (installments)
 * Campos monetários como STRING para evitar problemas de precisão JSON.
 */

const moneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Formato inválido. Use ex: "150.00"')
  .refine((v) => parseFloat(v) > 0, 'Valor deve ser maior que zero');
const moneyNumberSchema = z.coerce.number().positive('Valor deve ser maior que zero');

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido. Use YYYY-MM-DD');

export const createInstallmentPlanDTOSchema = z
  .object({
    contratoId: z.string().min(1, 'contratoId é obrigatório'),
    matriculaId: z.string().min(1, 'matriculaId é obrigatório'),

    /** Valor canônico numérico (cada parcela) */
    value: moneyNumberSchema.optional(),
    /** Compat legado temporário */
    amount: moneyStringSchema.optional(),

    /** Vencimento da primeira parcela no formato YYYY-MM-DD */
    firstDueDate: isoDateSchema,

    billingType: z.enum(['BOLETO', 'CREDIT_CARD', 'PIX', 'UNDEFINED']),

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

export type CreateInstallmentPlanDTO = z.infer<typeof createInstallmentPlanDTOSchema>;
