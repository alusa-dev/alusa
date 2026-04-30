import { z } from 'zod';

import { subscriptionStatusSchema } from './create-subscription-result.dto';

export const subscriptionListItemDTOSchema = z
  .object({
    id: z.string(),
    contratoId: z.string(),
    matriculaId: z.string(),
    externalReference: z.string(),
    asaasSubscriptionId: z.string().nullable(),
    status: subscriptionStatusSchema,
    createdAt: z.string(),
    statusUpdatedAt: z.string(),
  })
  .strict();

export type SubscriptionListItemDTO = z.infer<typeof subscriptionListItemDTOSchema>;

export const listSubscriptionsResultDTOSchema = z
  .object({
    items: z.array(subscriptionListItemDTOSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  })
  .strict();

export type ListSubscriptionsResultDTO = z.infer<typeof listSubscriptionsResultDTOSchema>;
