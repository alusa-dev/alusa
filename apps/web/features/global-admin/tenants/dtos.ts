import { z } from 'zod';

import { globalAdminStatusSchema } from '../shared/dtos';

export const globalAdminWebhookHealthDTOSchema = z.object({
  status: globalAdminStatusSchema,
  recommendations: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(['info', 'warning', 'critical']),
      message: z.string(),
    }),
  ),
  hasRemoteWebhook: z.boolean(),
  hasWebhookHash: z.boolean(),
});

export type GlobalAdminWebhookHealthDTO = z.infer<typeof globalAdminWebhookHealthDTOSchema>;

export const globalAdminQueueHealthDTOSchema = z.object({
  backlog: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  errored: z.number().int().nonnegative(),
  exhausted: z.number().int().nonnegative(),
  lagSeconds: z.number().nullable(),
});

export type GlobalAdminQueueHealthDTO = z.infer<typeof globalAdminQueueHealthDTOSchema>;

export const globalAdminFinancialDriftDTOSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.string(),
      descricao: z.string().nullable(),
      alunoNome: z.string(),
      status: z.string(),
      asaasStatus: z.string().nullable(),
      asaasPaymentId: z.string().nullable(),
      valor: z.number().nullable(),
      updatedAt: z.string(),
    }),
  ),
});

export type GlobalAdminFinancialDriftDTO = z.infer<typeof globalAdminFinancialDriftDTOSchema>;

export const globalAdminTenantEventDTOSchema = z.object({
  id: z.string(),
  evento: z.string(),
  eventId: z.string().nullable(),
  status: z.string(),
  tentativas: z.number().int().nonnegative(),
  recebidoEm: z.string(),
  processadoEm: z.string().nullable(),
  ultimoErro: z.string().nullable(),
  asaasPaymentId: z.string().nullable(),
});

export type GlobalAdminTenantEventDTO = z.infer<typeof globalAdminTenantEventDTOSchema>;

export const globalAdminTenant360DTOSchema = z.object({
  tenant: z.object({
    id: z.string(),
    nome: z.string(),
    financeStatus: z.string(),
    createdAt: z.string(),
  }),
  financial: z.object({
    financeProfileId: z.string().nullable(),
    asaasAccountId: z.string().nullable(),
    onboardingStatus: z.string().nullable(),
    asaasAccountStatus: z.string().nullable(),
    hasSubaccountCredentials: z.boolean(),
  }),
  webhook: globalAdminWebhookHealthDTOSchema,
  queue: globalAdminQueueHealthDTOSchema,
  latestEvents: z.array(globalAdminTenantEventDTOSchema),
  divergentCharges: globalAdminFinancialDriftDTOSchema,
  auditPreview: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      status: z.enum(['SUCCESS', 'ERROR']),
      actorIdentifier: z.string(),
      reason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export type GlobalAdminTenant360DTO = z.infer<typeof globalAdminTenant360DTOSchema>;
