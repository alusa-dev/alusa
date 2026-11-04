import { z } from 'zod';
const dateLikeDTOSchema = z.union([z.string(), z.date()]);

export const listUsersItemDTOSchema = z.object({
  id: z.string(), name: z.string(), email: z.string().email(), role: z.string(), status: z.string(),
  createdAt: dateLikeDTOSchema, createdVia: z.enum(['INVITE', 'DIRECT']), isCurrentUser: z.boolean(), isOwner: z.boolean(),
  permissions: z.object({ canEdit: z.boolean(), canToggleStatus: z.boolean(), canDelete: z.boolean() }),
}).strict();
export type ListUsersItemDTO = z.infer<typeof listUsersItemDTOSchema>;
export const listUsersResultDTOSchema = z.object({ items: z.array(listUsersItemDTOSchema) }).strict();
export type ListUsersResultDTO = z.infer<typeof listUsersResultDTOSchema>;

export const usersCountResultDTOSchema = z.object({ count: z.number().int().nonnegative() });
export type UsersCountResultDTO = z.infer<typeof usersCountResultDTOSchema>;
export const updateManagedUserInputDTOSchema = z.object({ name: z.string().min(2, 'Nome muito curto').optional(), status: z.enum(['ATIVO', 'INATIVO']).optional() }).strict();
export type UpdateManagedUserInputDTO = z.input<typeof updateManagedUserInputDTOSchema>;
export const managedUserSummaryDTOSchema = z.object({ id: z.string(), name: z.string(), email: z.string().email(), role: z.string(), status: z.string() }).strict();
export type ManagedUserSummaryDTO = z.infer<typeof managedUserSummaryDTOSchema>;
export const updateManagedUserResultDTOSchema = z.object({ user: managedUserSummaryDTOSchema }).strict();
export type UpdateManagedUserResultDTO = z.infer<typeof updateManagedUserResultDTOSchema>;
export const deleteManagedUserResultDTOSchema = z.object({ ok: z.literal(true), id: z.string(), hard: z.boolean() }).strict();
export type DeleteManagedUserResultDTO = z.infer<typeof deleteManagedUserResultDTOSchema>;
export const deleteManagedUserInputDTOSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export type DeleteManagedUserInputDTO = z.input<typeof deleteManagedUserInputDTOSchema>;
