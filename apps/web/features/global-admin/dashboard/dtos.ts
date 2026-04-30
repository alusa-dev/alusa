import { z } from 'zod';

import { globalAdminSeveritySchema } from '../shared/dtos';

export const globalAdminIncidentDTOSchema = z.object({
  tenantId: z.string(),
  tenantName: z.string(),
  severity: globalAdminSeveritySchema,
  categories: z.array(z.string()),
  summary: z.string(),
  href: z.string(),
  metrics: z.object({
    backlog: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    financialDrift: z.number().int().nonnegative(),
  }),
});

export type GlobalAdminIncidentDTO = z.infer<typeof globalAdminIncidentDTOSchema>;

export const globalAdminDashboardDTOSchema = z.object({
  generatedAt: z.string(),
  summary: z.object({
    activeIncidents: z.number().int().nonnegative(),
    tenantsWithBadWebhook: z.number().int().nonnegative(),
    queuesWithError: z.number().int().nonnegative(),
    globalBacklog: z.number().int().nonnegative(),
    financialDivergences: z.number().int().nonnegative(),
  }),
  business: z.object({
    activeUsers: z.number().int().nonnegative(),
    activeAccounts: z.number().int().nonnegative(),
    cancelledAccounts: z.number().int().nonnegative(),
    cancelledInWindow: z.number().int().nonnegative(),
    pendingAccessUsers: z.number().int().nonnegative(),
    recentUsersInWindow: z.number().int().nonnegative(),
    requestErrorsInWindow: z.number().int().nonnegative(),
  }),
  recentCancellations: z.array(
    z.object({
      tenantId: z.string(),
      tenantName: z.string(),
      cancelledAt: z.string(),
      reason: z.string().nullable(),
    }),
  ),
  recentUsers: z.array(
    z.object({
      userId: z.string(),
      nome: z.string(),
      email: z.string(),
      tenantId: z.string(),
      tenantName: z.string(),
      createdAt: z.string(),
      href: z.string(),
    }),
  ),
  incidents: z.array(globalAdminIncidentDTOSchema),
});

export type GlobalAdminDashboardDTO = z.infer<typeof globalAdminDashboardDTOSchema>;
