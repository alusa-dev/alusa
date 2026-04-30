import { z } from 'zod';

const globalAdminActionBaseSchema = z.object({
  tenantId: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(300),
});

export const globalAdminRepairWebhookRequestDTOSchema = globalAdminActionBaseSchema;
export const globalAdminRemoveBackoffRequestDTOSchema = globalAdminActionBaseSchema;
export const globalAdminProcessQueueRequestDTOSchema = globalAdminActionBaseSchema.extend({
  limit: z.number().int().min(1).max(500).optional(),
});
export const globalAdminReplayEventRequestDTOSchema = globalAdminActionBaseSchema.extend({
  eventId: z.string().trim().min(1),
  force: z.boolean().optional(),
});
export const globalAdminReconcilePaymentRequestDTOSchema = globalAdminActionBaseSchema.extend({
  asaasPaymentId: z.string().trim().min(1),
  eventName: z.string().trim().optional(),
});
export const globalAdminReconcileTenantRequestDTOSchema = globalAdminActionBaseSchema.extend({
  windowHours: z.number().int().min(1).max(720).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const globalAdminActionResultDTOSchema = z.object({
  success: z.boolean(),
  action: z.string(),
  tenantId: z.string(),
  summary: z.string(),
  auditId: z.string().nullable(),
  data: z.unknown().optional(),
});

export type GlobalAdminActionResultDTO = z.infer<typeof globalAdminActionResultDTOSchema>;
