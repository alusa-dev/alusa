import { z } from 'zod';

import { transferStatusSchema } from './request-withdraw-result.dto';

export const transferDetailRecipientDTOSchema = z.object({
  name: z.string().nullable(),
  cpfCnpj: z.string().nullable(),
  bankName: z.string().nullable(),
  pixKey: z.string().nullable(),
  agency: z.string().nullable(),
  account: z.string().nullable(),
  accountDigit: z.string().nullable(),
  accountType: z.string().nullable(),
});

export const transferTimelineItemDTOSchema = z.object({
  key: z.string(),
  label: z.string(),
  at: z.string().nullable(),
  status: z.enum(['DONE', 'CURRENT', 'PENDING', 'FAILED', 'CANCELED']),
  detail: z.string().nullable(),
});

export const transferOperationalAlertDTOSchema = z.object({
  severity: z.enum(['info', 'warning', 'error']),
  code: z.string(),
  message: z.string(),
});

export const transferDetailResultDTOSchema = z.object({
  id: z.string(),
  externalReference: z.string(),
  asaasTransferId: z.string().nullable(),
  amount: z.string(),
  feeAmount: z.string().nullable(),
  netAmount: z.string(),
  status: transferStatusSchema,
  operation: z.enum(['PIX', 'TED']),
  requestedDestinationType: z.enum(['PIX_KEY', 'BANK_ACCOUNT']).nullable(),
  description: z.string().nullable(),
  scheduleDate: z.string().nullable(),
  transferDate: z.string().nullable(),
  createdAt: z.string(),
  statusUpdatedAt: z.string().nullable(),
  transactionReceiptUrl: z.string().nullable(),
  endToEndIdentifier: z.string().nullable(),
  failReason: z.string().nullable(),
  authorized: z.boolean().nullable(),
  canCancel: z.boolean(),
  lastWebhookAt: z.string().nullable(),
  lastReconciledAt: z.string().nullable(),
  timeline: z.array(transferTimelineItemDTOSchema),
  operationalAlerts: z.array(transferOperationalAlertDTOSchema),
  recipient: transferDetailRecipientDTOSchema,
});

export type TransferDetailRecipientDTO = z.infer<typeof transferDetailRecipientDTOSchema>;
export type TransferTimelineItemDTO = z.infer<typeof transferTimelineItemDTOSchema>;
export type TransferOperationalAlertDTO = z.infer<typeof transferOperationalAlertDTOSchema>;
export type TransferDetailResultDTO = z.infer<typeof transferDetailResultDTOSchema>;
