import { z } from 'zod';

import { installmentStatusSchema } from './create-installment-plan-result.dto';

export const installmentPlanListItemDTOSchema = z
  .object({
    id: z.string(),
    contratoId: z.string(),
    matriculaId: z.string(),
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

export type InstallmentPlanListItemDTO = z.infer<typeof installmentPlanListItemDTOSchema>;

export const listInstallmentPlansResultDTOSchema = z
  .object({
    items: z.array(installmentPlanListItemDTOSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  })
  .strict();

export type ListInstallmentPlansResultDTO = z.infer<typeof listInstallmentPlansResultDTOSchema>;
