import { z } from 'zod';

export const globalAdminSearchItemDTOSchema = z.object({
  type: z.enum(['tenant', 'user', 'charge', 'matricula', 'webhook', 'asaas_account']),
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  tenantId: z.string().nullable(),
  tenantName: z.string().nullable(),
  href: z.string(),
});

export type GlobalAdminSearchItemDTO = z.infer<typeof globalAdminSearchItemDTOSchema>;

export const globalAdminSearchGroupDTOSchema = z.object({
  key: z.string(),
  label: z.string(),
  total: z.number().int().nonnegative(),
  items: z.array(globalAdminSearchItemDTOSchema),
});

export type GlobalAdminSearchGroupDTO = z.infer<typeof globalAdminSearchGroupDTOSchema>;

export const globalAdminSearchResultDTOSchema = z.object({
  query: z.string(),
  groups: z.array(globalAdminSearchGroupDTOSchema),
});

export type GlobalAdminSearchResultDTO = z.infer<typeof globalAdminSearchResultDTOSchema>;
