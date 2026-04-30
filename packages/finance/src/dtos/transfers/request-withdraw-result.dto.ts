import { z } from 'zod';

/**
 * DTO de resposta para solicitação de saque/transferência
 * Expõe apenas campos públicos necessários para o frontend
 */

export const transferStatusSchema = z.enum([
  'REQUESTED',
  'PENDING',
  'BLOCKED',
  'PROCESSING',
  'DONE',
  'CANCELED',
  'FAILED',
]);

export type TransferStatusDTO = z.infer<typeof transferStatusSchema>;

export const requestWithdrawResultDTOSchema = z.object({
  /** ID público da transferência */
  id: z.string(),
  /** Referência externa (para conciliação) */
  externalReference: z.string(),
  /** Status atual da transferência */
  status: transferStatusSchema,
  /** Valor solicitado em string decimal, ex: "150.00" */
  amount: z.string(),
  /** Data de criação ISO */
  createdAt: z.string(),
});

export type RequestWithdrawResultDTO = z.infer<typeof requestWithdrawResultDTOSchema>;
