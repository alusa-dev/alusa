import { z } from 'zod';

const moneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Formato inválido. Use ex: "150.00"')
  .refine((v) => parseFloat(v) >= 0, 'Valor deve ser >= 0');

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido. Use YYYY-MM-DD');

const taxRateSchema = z
  .number()
  .min(0, 'Taxa deve ser >= 0')
  .max(100, 'Taxa deve ser <= 100');

export const createInvoiceDTOSchema = z
  .object({
    chargeId: z.string().min(1, 'chargeId é obrigatório'),

    serviceDescription: z.string().min(1, 'serviceDescription é obrigatório').max(2000),
    observations: z.string().min(1, 'observations é obrigatório').max(2000),

    value: moneyStringSchema,
    deductions: moneyStringSchema,
    effectiveDate: isoDateSchema,

    municipalServiceCode: z.string().min(1).max(30).optional(),
    municipalServiceName: z.string().min(1, 'municipalServiceName é obrigatório').max(255),

    taxes: z
      .object({
        retainIss: z.boolean(),
        cofins: taxRateSchema,
        csll: taxRateSchema,
        inss: taxRateSchema,
        ir: taxRateSchema,
        pis: taxRateSchema,
        iss: taxRateSchema,
      })
      .strict(),

    updatePayment: z.boolean().optional(),
  })
  .strict();

export type CreateInvoiceDTO = z.infer<typeof createInvoiceDTOSchema>;
