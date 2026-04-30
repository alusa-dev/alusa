import { z } from 'zod';

import { transferStatusSchema } from './request-withdraw-result.dto';

/**
 * DTO de item de transferência para listagem
 * Expõe apenas campos públicos necessários para o frontend
 */

export const transferListItemDTOSchema = z.object({
  /** ID público da transferência */
  id: z.string(),
  /** Referência externa (para conciliação) */
  externalReference: z.string(),
  /** Valor em string decimal, ex: "150.00" */
  amount: z.string(),
  /** Taxa oficial da transferência em string decimal */
  feeAmount: z.string().nullable(),
  /** Valor líquido exibido na listagem */
  netAmount: z.string(),
  /** Status atual */
  status: transferStatusSchema,
  /** Operação exibida na tabela */
  operation: z.enum(['PIX', 'TED']),
  /** Nome do destinatário */
  recipientName: z.string().nullable(),
  /** CPF/CNPJ mascarado */
  cpfCnpj: z.string().nullable(),
  /** Banco exibido na tabela */
  bankName: z.string().nullable(),
  /** Descrição (se houver) */
  description: z.string().nullable(),
  /** Data agendada ISO */
  scheduleDate: z.string().nullable(),
  /** Data efetiva/espelhada da transferência ISO */
  transferDate: z.string().nullable(),
  /** Data de criação ISO */
  createdAt: z.string(),
  /** Data de última atualização de status ISO (pode ser null) */
  statusUpdatedAt: z.string().nullable(),
});

export type TransferListItemDTO = z.infer<typeof transferListItemDTOSchema>;

export const listTransfersResultDTOSchema = z.object({
  items: z.array(transferListItemDTOSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export type ListTransfersResultDTO = z.infer<typeof listTransfersResultDTOSchema>;
