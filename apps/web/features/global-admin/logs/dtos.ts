import { z } from 'zod';

import { globalAdminSeveritySchema } from '../shared/dtos';

export const globalAdminRequestLogItemDTOSchema = z.object({
  id: z.string(),
  contaId: z.string(),
  contaNome: z.string(),
  tipoOperacao: z.string(),
  entidade: z.string(),
  entidadeId: z.string(),
  asaasId: z.string().nullable(),
  status: z.enum(['SUCCESS', 'ERROR']),
  httpStatus: z.number().nullable(),
  duration: z.number().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  href: z.string(),
});

export type GlobalAdminRequestLogItemDTO = z.infer<typeof globalAdminRequestLogItemDTOSchema>;

export const globalAdminRequestLogResultDTOSchema = z.object({
  generatedAt: z.string(),
  total: z.number().int().nonnegative(),
  items: z.array(globalAdminRequestLogItemDTOSchema),
});

export type GlobalAdminRequestLogResultDTO = z.infer<typeof globalAdminRequestLogResultDTOSchema>;

export const globalAdminWebhookLogItemDTOSchema = z.object({
  id: z.string(),
  source: z.enum(['WEBHOOK', 'REJECTION']),
  contaId: z.string().nullable(),
  contaNome: z.string().nullable(),
  evento: z.string().nullable(),
  eventId: z.string().nullable(),
  status: z.string(),
  tentativas: z.number().int().nonnegative(),
  receivedAt: z.string(),
  processedAt: z.string().nullable(),
  asaasPaymentId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  href: z.string().nullable(),
});

export type GlobalAdminWebhookLogItemDTO = z.infer<typeof globalAdminWebhookLogItemDTOSchema>;

export const globalAdminWebhookLogResultDTOSchema = z.object({
  generatedAt: z.string(),
  total: z.number().int().nonnegative(),
  items: z.array(globalAdminWebhookLogItemDTOSchema),
});

export type GlobalAdminWebhookLogResultDTO = z.infer<typeof globalAdminWebhookLogResultDTOSchema>;

export const globalAdminErrorLogItemDTOSchema = z.object({
  id: z.string(),
  kind: z.enum(['REQUISICAO', 'WEBHOOK', 'ADMIN']),
  contaId: z.string().nullable(),
  contaNome: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  severity: globalAdminSeveritySchema,
  createdAt: z.string(),
  href: z.string().nullable(),
});

export type GlobalAdminErrorLogItemDTO = z.infer<typeof globalAdminErrorLogItemDTOSchema>;

export const globalAdminErrorLogResultDTOSchema = z.object({
  generatedAt: z.string(),
  total: z.number().int().nonnegative(),
  items: z.array(globalAdminErrorLogItemDTOSchema),
});

export type GlobalAdminErrorLogResultDTO = z.infer<typeof globalAdminErrorLogResultDTOSchema>;
