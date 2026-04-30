import { z } from 'zod';

export const globalAdminAuditLogEntryDTOSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  action: z.string(),
  actorIdentifier: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  reason: z.string().nullable(),
  status: z.enum(['SUCCESS', 'ERROR']),
  summary: z.string().nullable(),
  createdAt: z.string(),
});

export type GlobalAdminAuditLogEntryDTO = z.infer<typeof globalAdminAuditLogEntryDTOSchema>;

export const globalAdminAuditLogResultDTOSchema = z.object({
  generatedAt: z.string(),
  entries: z.array(globalAdminAuditLogEntryDTOSchema),
});

export type GlobalAdminAuditLogResultDTO = z.infer<typeof globalAdminAuditLogResultDTOSchema>;
