import { z } from 'zod';

export const supportReasonSchema = z.string().trim().min(8).max(500);

export const createSupportNoteSchema = z.object({
  contaId: z.string().min(1),
  entityType: z.string().trim().min(1).max(80),
  entityId: z.string().trim().min(1).max(160),
  body: z.string().trim().min(2).max(4000),
  caseId: z.string().optional().nullable(),
  reason: supportReasonSchema,
});

export const createSupportCaseSchema = z.object({
  contaId: z.string().min(1),
  title: z.string().trim().min(4).max(160),
  description: z.string().trim().max(4000).optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  entityType: z.string().trim().max(80).optional().nullable(),
  entityId: z.string().trim().max(160).optional().nullable(),
  reason: supportReasonSchema,
});

export const supportEntityActionSchema = z.object({
  contaId: z.string().min(1),
  entityType: z.string().trim().min(1).max(80),
  entityId: z.string().trim().min(1).max(160),
  reason: supportReasonSchema,
});

export const supportChargeActionSchema = z.object({
  contaId: z.string().min(1),
  chargeId: z.string().min(1),
  reason: supportReasonSchema,
});

export const supportInviteActionSchema = z.object({
  contaId: z.string().min(1),
  inviteId: z.string().min(1),
  reason: supportReasonSchema,
});

export const supportWebhookActionSchema = z.object({
  contaId: z.string().min(1),
  webhookId: z.string().min(1),
  reason: supportReasonSchema,
});

export const supportAsaasRepairActionSchema = z.enum([
  'BOOTSTRAP_LOCAL',
  'ENQUEUE_PROVISION',
  'REPAIR_WEBHOOK',
  'RECONCILE',
  'LINK_SUBACCOUNT',
]);

export const supportAsaasDiagnoseSchema = z.object({
  contaId: z.string().min(1),
});

export const supportAsaasRepairSchema = z.object({
  contaId: z.string().min(1),
  reason: supportReasonSchema,
  action: supportAsaasRepairActionSchema,
  linkAsaasAccountId: z.string().trim().min(1).optional().nullable(),
});

export const supportAsaasSaveManualApiKeySchema = z.object({
  contaId: z.string().min(1),
  reason: supportReasonSchema,
  apiKey: z.string().trim().min(10),
  confirmations: z.object({
    generatedWithLocalScript: z.literal(true),
    belongsToExistingSubaccount: z.literal(true),
    rotatedExistingKeyWhenPresent: z.literal(true),
    understandsEncryptedStorage: z.literal(true),
  }),
});
