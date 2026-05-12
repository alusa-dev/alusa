import { z } from 'zod';

export const globalSearchItemTypeSchema = z.enum([
  'navigation',
  'action',
  'aluno',
  'responsavel',
  'matricula',
  'cobranca',
  'contrato',
]);

export type GlobalSearchItemType = z.infer<typeof globalSearchItemTypeSchema>;

export const globalSearchItemDTOSchema = z.object({
  type: globalSearchItemTypeSchema,
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  badgeLabel: z.string().nullable().optional(),
  href: z.string(),
});

export type GlobalSearchItemDTO = z.infer<typeof globalSearchItemDTOSchema>;

export const globalSearchGroupDTOSchema = z.object({
  key: z.string(),
  label: z.string(),
  total: z.number().int().nonnegative(),
  items: z.array(globalSearchItemDTOSchema),
});

export type GlobalSearchGroupDTO = z.infer<typeof globalSearchGroupDTOSchema>;

export const globalSearchResultDTOSchema = z.object({
  query: z.string(),
  groups: z.array(globalSearchGroupDTOSchema),
});

export type GlobalSearchResultDTO = z.infer<typeof globalSearchResultDTOSchema>;