import { z } from 'zod';

export const installmentStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'CANCELED']);
export type InstallmentStatusDTO = z.infer<typeof installmentStatusSchema>;

export const createInstallmentPlanResultDTOSchema = z
  .object({
    id: z.string(),
    externalReference: z.string(),
    asaasInstallmentId: z.string().nullable(),
    status: installmentStatusSchema,
    installmentCount: z.number().int(),
    billingType: z.string(),
    amount: z.string(),
    firstDueDate: z.string(),
    createdAt: z.string(),
    statusUpdatedAt: z.string(),
  })
  .strict();

export type CreateInstallmentPlanResultDTO = z.infer<typeof createInstallmentPlanResultDTOSchema>;
