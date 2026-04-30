import { z } from 'zod';

export const subscriptionStatusSchema = z.enum([
  'REQUESTED',
  'ACTIVE',
  'INACTIVE',
  'EXPIRED',
  'DELETED',
  'FAILED',
]);

export type SubscriptionStatusDTO = z.infer<typeof subscriptionStatusSchema>;

export const createSubscriptionResultDTOSchema = z
  .object({
    id: z.string(),
    externalReference: z.string(),
    asaasSubscriptionId: z.string().nullable(),
    status: subscriptionStatusSchema,
    amount: z.string(),
    createdAt: z.string(),
    statusUpdatedAt: z.string(),
  })
  .strict();

export type CreateSubscriptionResultDTO = z.infer<typeof createSubscriptionResultDTOSchema>;
