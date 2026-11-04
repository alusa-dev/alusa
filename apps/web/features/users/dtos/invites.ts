import { z } from 'zod';

const dateLikeDTOSchema = z.union([z.string(), z.date()]);

export const inviteRoleDTOSchema = z.enum(['ADMIN', 'FINANCEIRO', 'RECEPCAO', 'PROFESSOR', 'RESPONSAVEL']);
export type InviteRoleDTO = z.infer<typeof inviteRoleDTOSchema>;

export const inviteRecordTypeDTOSchema = z.enum(['COLABORADOR', 'RESPONSAVEL']);
export type InviteRecordTypeDTO = z.infer<typeof inviteRecordTypeDTOSchema>;

export const inviteTargetDTOSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('EXISTING_RECORD'), recordType: inviteRecordTypeDTOSchema, recordId: z.string().trim().min(1).max(191), role: inviteRoleDTOSchema }),
  z.object({ kind: z.literal('EMAIL'), email: z.string().trim().email('Email inválido').transform((value) => value.toLowerCase()), role: inviteRoleDTOSchema }),
]);
export type InviteTargetDTO = z.infer<typeof inviteTargetDTOSchema>;

const legacyCreateInviteInputDTOSchema = z.object({
  email: z.union([z.string().trim().email('Email inválido').transform((value) => value.toLowerCase()), z.null()]).optional(),
  role: inviteRoleDTOSchema.default('RECEPCAO'),
  alunosIds: z.array(z.string().trim().min(1).max(191)).max(100).optional(),
}).strict();

export const createInviteInputDTOSchema = z.union([
  z.object({ target: inviteTargetDTOSchema }).strict(),
  legacyCreateInviteInputDTOSchema,
]);
export type CreateInviteInputDTO = z.input<typeof createInviteInputDTOSchema>;

export const inviteSummaryDTOSchema = z.object({
  id: z.string(), email: z.string().email().nullable(), role: inviteRoleDTOSchema,
  status: z.enum(['PENDING', 'EXPIRED', 'ACCEPTED', 'REVOKED']),
  createdAt: dateLikeDTOSchema, expiresAt: dateLikeDTOSchema,
}).strict();
export type InviteSummaryDTO = z.infer<typeof inviteSummaryDTOSchema>;

export const listInvitesResultDTOSchema = z.object({ items: z.array(inviteSummaryDTOSchema) }).strict();
export type ListInvitesResultDTO = z.infer<typeof listInvitesResultDTOSchema>;

export const createdInviteDTOSchema = inviteSummaryDTOSchema.extend({ inviteUrl: z.string().url() }).strict();
export type CreatedInviteDTO = z.infer<typeof createdInviteDTOSchema>;

export const createInviteResultDTOSchema = z.object({
  invite: createdInviteDTOSchema,
  emailDelivery: z.enum(['sent', 'logged', 'failed', 'not_applicable']).default('not_applicable'),
}).strict();
export type CreateInviteResultDTO = z.infer<typeof createInviteResultDTOSchema>;

export const inviteCandidatesQueryDTOSchema = z.object({
  recordType: inviteRecordTypeDTOSchema,
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type InviteCandidatesQueryDTO = z.infer<typeof inviteCandidatesQueryDTOSchema>;

export const inviteCandidateDTOSchema = z.object({
  kind: z.literal('EXISTING_RECORD'), recordType: inviteRecordTypeDTOSchema,
  recordId: z.string(), name: z.string(), email: z.string().email().nullable(),
  students: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
  accessStatus: z.enum(['ACTIVE', 'SUSPENDED', 'NONE']),
  inviteStatus: z.enum(['PENDING', 'NONE']),
  canInvite: z.boolean(),
}).strict();
export type InviteCandidateDTO = z.infer<typeof inviteCandidateDTOSchema>;
export const inviteCandidatesResultDTOSchema = z.object({
  items: z.array(inviteCandidateDTOSchema), page: z.number().int().positive(), limit: z.number().int().positive(), hasMore: z.boolean(),
}).strict();
export type InviteCandidatesResultDTO = z.infer<typeof inviteCandidatesResultDTOSchema>;

export const validateInviteQueryDTOSchema = z.object({ token: z.string().min(1) });
export type ValidateInviteQueryDTO = z.infer<typeof validateInviteQueryDTOSchema>;
export const validateInviteResultDTOSchema = z.object({ email: z.string().email().nullable().optional(), role: z.string() });
export type ValidateInviteResultDTO = z.infer<typeof validateInviteResultDTOSchema>;

export const acceptInviteInputDTOSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório'),
  password: z.string().min(1).max(256).optional(),
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres').optional(), email: z.string().email('E-mail inválido').optional(),
  senha: z.string().optional(), nome: z.string().optional(),
}).strict();
export type AcceptInviteInputDTO = z.input<typeof acceptInviteInputDTOSchema>;

export const acceptInviteResultDTOSchema = z.object({
  message: z.string(), verificationEmailSent: z.boolean().optional(), verificationRequired: z.boolean().optional(),
  user: z.object({ id: z.string(), email: z.string().email(), role: z.string(), contaId: z.string().nullable().optional(), emailVerified: z.boolean().optional() }),
});
export type AcceptInviteResultDTO = z.infer<typeof acceptInviteResultDTOSchema>;

export const deleteInviteResultDTOSchema = z.object({ ok: z.literal(true) });
export type DeleteInviteResultDTO = z.infer<typeof deleteInviteResultDTOSchema>;
