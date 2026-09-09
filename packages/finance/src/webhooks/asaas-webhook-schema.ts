import { z } from 'zod';

import type { AsaasWebhookPayload } from '@alusa/asaas-gateway';

/**
 * Validação de borda para Webhooks recebidos do Asaas.
 *
 * O Asaas pode acrescentar campos ao payload. Por isso os objetos são
 * `passthrough()`: validamos a forma mínima necessária para roteamento e
 * correlação, sem rejeitar campos novos que ainda não sejam consumidos pela
 * Alusa.
 */
const providerResourceSchema = z
  .object({ id: z.string().trim().min(1) })
  .passthrough();

export const asaasWebhookPayloadSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    event: z.string().trim().min(1),
    dateCreated: z.string().trim().min(1).optional(),
    additionalInfo: z
      .object({ scheduledDate: z.string().trim().min(1).optional() })
      .passthrough()
      .optional(),
    payment: providerResourceSchema.optional(),
    subscription: providerResourceSchema.optional(),
    transfer: providerResourceSchema.optional(),
    internalTransfer: providerResourceSchema.optional(),
    anticipation: providerResourceSchema.optional(),
    accountStatus: z.record(z.unknown()).optional(),
    invoice: providerResourceSchema.optional(),
    bill: providerResourceSchema.optional(),
    checkout: providerResourceSchema.optional(),
  })
  .passthrough();

export type ParsedAsaasWebhookPayload =
  | { success: true; payload: AsaasWebhookPayload }
  | { success: false; reason: string };

export function parseAsaasWebhookPayload(rawBody: string): ParsedAsaasWebhookPayload {
  let candidate: unknown;

  try {
    candidate = JSON.parse(rawBody);
  } catch {
    return { success: false, reason: 'JSON inválido' };
  }

  const parsed = asaasWebhookPayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join('.') : 'payload';
    return { success: false, reason: `Payload inválido em ${path}` };
  }

  return {
    success: true,
    payload: parsed.data as AsaasWebhookPayload,
  };
}
