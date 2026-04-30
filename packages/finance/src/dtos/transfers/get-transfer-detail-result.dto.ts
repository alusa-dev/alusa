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

export const transferDetailResultDTOSchema = z.object({
  id: z.string(),
  externalReference: z.string(),
  asaasTransferId: z.string().nullable(),
  amount: z.string(),
  feeAmount: z.string().nullable(),
  netAmount: z.string(),
  status: transferStatusSchema,
  operation: z.enum(['PIX', 'TED']),
  description: z.string().nullable(),
  scheduleDate: z.string().nullable(),
  transferDate: z.string().nullable(),
  createdAt: z.string(),
  statusUpdatedAt: z.string().nullable(),
  transactionReceiptUrl: z.string().nullable(),
  endToEndIdentifier: z.string().nullable(),
  failReason: z.string().nullable(),
  authorized: z.boolean().nullable(),
  recipient: transferDetailRecipientDTOSchema,
});

export type TransferDetailRecipientDTO = z.infer<typeof transferDetailRecipientDTOSchema>;
export type TransferDetailResultDTO = z.infer<typeof transferDetailResultDTOSchema>;