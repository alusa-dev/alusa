import { z } from 'zod';

import { globalAdminSeveritySchema } from '../shared/dtos';

export const globalAdminSupportCaseDTOSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: globalAdminSeveritySchema,
  title: z.string(),
  summary: z.string(),
  contaId: z.string().nullable(),
  contaNome: z.string().nullable(),
  personName: z.string().nullable(),
  detectedAt: z.string(),
  statusLabel: z.string(),
  suggestedAction: z.string(),
  href: z.string(),
});

export type GlobalAdminSupportCaseDTO = z.infer<typeof globalAdminSupportCaseDTOSchema>;

export const globalAdminSupportCaseResultDTOSchema = z.object({
  generatedAt: z.string(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    informational: z.number().int().nonnegative(),
  }),
  items: z.array(globalAdminSupportCaseDTOSchema),
});

export type GlobalAdminSupportCaseResultDTO = z.infer<typeof globalAdminSupportCaseResultDTOSchema>;
