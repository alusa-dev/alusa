import { z } from 'zod';

import { globalAdminAuditLogEntryDTOSchema } from '../audit/dtos';
import {
  globalAdminErrorLogItemDTOSchema,
  globalAdminRequestLogItemDTOSchema,
  globalAdminWebhookLogItemDTOSchema,
} from '../logs/dtos';

export const globalAdminUserListItemDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.string(),
  telefone: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  accessStatus: z.string(),
  contaId: z.string(),
  contaNome: z.string(),
  contaStatus: z.enum(['ATIVA', 'CANCELADA']),
  financeStatus: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  href: z.string(),
});

export type GlobalAdminUserListItemDTO = z.infer<typeof globalAdminUserListItemDTOSchema>;

export const globalAdminUserListDTOSchema = z.object({
  generatedAt: z.string(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    activeUsers: z.number().int().nonnegative(),
    pendingAccess: z.number().int().nonnegative(),
    cancelledAccounts: z.number().int().nonnegative(),
  }),
  items: z.array(globalAdminUserListItemDTOSchema),
});

export type GlobalAdminUserListDTO = z.infer<typeof globalAdminUserListDTOSchema>;

export const globalAdminUserSupportProfileDTOSchema = z.object({
  user: z.object({
    id: z.string(),
    nome: z.string(),
    email: z.string(),
    telefone: z.string().nullable(),
    role: z.string(),
    status: z.string(),
    createdAt: z.string(),
    emailVerifiedAt: z.string().nullable(),
    contaId: z.string(),
    contaNome: z.string(),
    financeStatus: z.string(),
    accountDeletedAt: z.string().nullable(),
    accountDeleteReason: z.string().nullable(),
  }),
  support: z.object({
    accessStatus: z.string(),
    passwordResetOpenRequests: z.number().int().nonnegative(),
    lastPasswordResetAt: z.string().nullable(),
    openCharges: z.number().int().nonnegative(),
    divergentCharges: z.number().int().nonnegative(),
    integrationErrors: z.number().int().nonnegative(),
    webhookErrors: z.number().int().nonnegative(),
  }),
  recentCharges: z.array(
    z.object({
      id: z.string(),
      descricao: z.string().nullable(),
      status: z.string(),
      asaasStatus: z.string().nullable(),
      vencimento: z.string(),
      valor: z.number().nullable(),
      href: z.string(),
    }),
  ),
  recentRequestLogs: z.array(globalAdminRequestLogItemDTOSchema),
  recentWebhookLogs: z.array(globalAdminWebhookLogItemDTOSchema),
  recentErrors: z.array(globalAdminErrorLogItemDTOSchema),
  auditPreview: z.array(globalAdminAuditLogEntryDTOSchema),
});

export type GlobalAdminUserSupportProfileDTO = z.infer<typeof globalAdminUserSupportProfileDTOSchema>;
