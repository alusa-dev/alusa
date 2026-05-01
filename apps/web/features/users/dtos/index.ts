import { z } from 'zod';

import { authRegisterInputSchema } from '@/lib/dtos/auth-register.dto';
import { PROFILE_LOCALE_VALUES, PROFILE_THEME_VALUES } from '@/lib/profile-preferences';

const dateLikeDTOSchema = z.union([z.string(), z.date()]);

export const notificationPreferencesDTOSchema = z.object({
  emailProduct: z.boolean(),
  emailSecurity: z.boolean(),
  emailMarketing: z.boolean(),
  whatsapp: z.boolean(),
  sms: z.boolean(),
});

export type NotificationPreferencesDTO = z.infer<typeof notificationPreferencesDTOSchema>;

export const userSchoolAddressDTOSchema = z.object({
  street: z.string(),
  number: z.string(),
  district: z.string(),
  city: z.string(),
  state: z.string(),
  cep: z.string(),
});

export type UserSchoolAddressDTO = z.infer<typeof userSchoolAddressDTOSchema>;

export const userSchoolSummaryDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  cpfCnpj: z.string().nullable().optional(),
  status: z.string(),
  ownerUserId: z.string().nullable().optional(),
  address: userSchoolAddressDTOSchema.optional(),
});

export type UserSchoolSummaryDTO = z.infer<typeof userSchoolSummaryDTOSchema>;

export const userSchoolProfileDTOSchema = userSchoolSummaryDTOSchema.extend({
  address: userSchoolAddressDTOSchema,
});

export type UserSchoolProfileDTO = z.infer<typeof userSchoolProfileDTOSchema>;

export const userProfileDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  telefone: z.string().nullable().optional(),
  foto: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  locale: z.enum(PROFILE_LOCALE_VALUES),
  theme: z.enum(PROFILE_THEME_VALUES),
  notifications: notificationPreferencesDTOSchema,
});

export type UserProfileDTO = z.infer<typeof userProfileDTOSchema>;

export const userProfileWithSchoolDTOSchema = userProfileDTOSchema.extend({
  school: userSchoolProfileDTOSchema.nullable(),
});

export type UserProfileWithSchoolDTO = z.infer<typeof userProfileWithSchoolDTOSchema>;

export const updateCurrentProfileInputDTOSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto').max(120, 'Nome muito longo').optional(),
    telefone: z.string().trim().max(20, 'Telefone invalido').optional(),
    foto: z
      .union([
        z
          .string()
          .trim()
          .refine(
            (value) =>
              /^https?:\/\//i.test(value) ||
              value.startsWith('/uploads/') ||
              value.startsWith('/api/files/'),
            'URL invalida',
          ),
        z.literal(null),
      ])
      .optional(),
    bio: z.string().trim().max(280, 'Bio deve ter no maximo 280 caracteres').optional(),
    locale: z.enum(PROFILE_LOCALE_VALUES).optional(),
    theme: z.enum(PROFILE_THEME_VALUES).optional(),
  })
  .strict();

export type UpdateCurrentProfileInputDTO = z.input<typeof updateCurrentProfileInputDTOSchema>;

export const changeEmailInputDTOSchema = z.object({
  newEmail: z.string().email('Email invalido').transform((value) => value.trim().toLowerCase()),
  currentPassword: z.string().min(1, 'Senha atual obrigatoria'),
});

export type ChangeEmailInputDTO = z.input<typeof changeEmailInputDTOSchema>;

export const changeEmailResultDTOSchema = z.object({
  success: z.literal(true),
  email: z.string().email(),
});

export type ChangeEmailResultDTO = z.infer<typeof changeEmailResultDTOSchema>;

const passwordMinLength = Number(process.env.PASSWORD_MIN_LENGTH || 8);
const passwordMessage =
  'Senha deve ter no minimo 8 caracteres, com maiuscula, minuscula, numero e simbolo.';
const passwordRegex = new RegExp(
  `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{${String(passwordMinLength)},}$`,
);

export const changePasswordInputDTOSchema = z.object({
  currentPassword: z.string().min(passwordMinLength, 'Senha atual invalida'),
  newPassword: z.string().regex(passwordRegex, passwordMessage),
});

export type ChangePasswordInputDTO = z.input<typeof changePasswordInputDTOSchema>;

export const simpleSuccessResultDTOSchema = z.object({
  success: z.literal(true),
});

export type SimpleSuccessResultDTO = z.infer<typeof simpleSuccessResultDTOSchema>;

export const updateNotificationPreferencesInputDTOSchema = notificationPreferencesDTOSchema;

export type UpdateNotificationPreferencesInputDTO = z.input<
  typeof updateNotificationPreferencesInputDTOSchema
>;

export const updateNotificationPreferencesResultDTOSchema = z.object({
  notifications: notificationPreferencesDTOSchema,
});

export type UpdateNotificationPreferencesResultDTO = z.infer<
  typeof updateNotificationPreferencesResultDTOSchema
>;

export const updateSchoolInputDTOSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome muito curto').max(120, 'Nome muito longo').optional(),
    cpfCnpj: z.string().trim().regex(/^[0-9.\-/]{11,18}$/i, 'CNPJ/CPF inválido').optional(),
  })
  .strict();

export type UpdateSchoolInputDTO = z.input<typeof updateSchoolInputDTOSchema>;

export const updateSchoolAddressInputDTOSchema = z
  .object({
    street: z.string().trim().max(120).optional(),
    number: z.string().trim().max(20).optional(),
    district: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(2).optional(),
    cep: z.string().trim().regex(/^\d{5}-?\d{3}$/).optional(),
  })
  .strict();

export type UpdateSchoolAddressInputDTO = z.input<typeof updateSchoolAddressInputDTOSchema>;

export const listUsersItemDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  status: z.string(),
  createdAt: dateLikeDTOSchema,
  createdVia: z.enum(['INVITE', 'DIRECT']),
  isCurrentUser: z.boolean(),
  isOwner: z.boolean(),
  permissions: z.object({
    canEdit: z.boolean(),
    canToggleStatus: z.boolean(),
    canDelete: z.boolean(),
  }),
});

export type ListUsersItemDTO = z.infer<typeof listUsersItemDTOSchema>;

export const listUsersResultDTOSchema = z.object({
  items: z.array(listUsersItemDTOSchema),
});

export type ListUsersResultDTO = z.infer<typeof listUsersResultDTOSchema>;

export const inviteRoleDTOSchema = z.enum([
  'ADMIN',
  'FINANCEIRO',
  'RECEPCAO',
  'PROFESSOR',
  'RESPONSAVEL',
]);

export type InviteRoleDTO = z.infer<typeof inviteRoleDTOSchema>;

export const inviteSummaryDTOSchema = z
  .object({
    id: z.string(),
    email: z.string().email().nullable().optional(),
    role: z.string(),
    status: z.string().optional(),
    token: z.string().optional(),
    inviteUrl: z.string().optional(),
    createdAt: dateLikeDTOSchema.optional(),
    expiresAt: dateLikeDTOSchema.optional(),
  })
  .passthrough();

export type InviteSummaryDTO = z.infer<typeof inviteSummaryDTOSchema>;

export const listInvitesResultDTOSchema = z.object({
  items: z.array(inviteSummaryDTOSchema),
});

export type ListInvitesResultDTO = z.infer<typeof listInvitesResultDTOSchema>;

export const createInviteInputDTOSchema = z.object({
  email: z.union([z.string().email('Email inválido'), z.null(), z.undefined()]).optional(),
  role: inviteRoleDTOSchema.default('RECEPCAO'),
  escolaId: z.string().optional(),
  alunosIds: z.array(z.string()).optional(),
});

export type CreateInviteInputDTO = z.input<typeof createInviteInputDTOSchema>;

export const createInviteResultDTOSchema = z.object({
  invite: inviteSummaryDTOSchema,
});

export type CreateInviteResultDTO = z.infer<typeof createInviteResultDTOSchema>;

export const validateInviteQueryDTOSchema = z.object({
  token: z.string().min(1),
});

export type ValidateInviteQueryDTO = z.infer<typeof validateInviteQueryDTOSchema>;

export const validateInviteResultDTOSchema = z.object({
  email: z.string().email().nullable().optional(),
  role: z.string(),
});

export type ValidateInviteResultDTO = z.infer<typeof validateInviteResultDTOSchema>;

export const acceptInviteInputDTOSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório'),
  password: z.string().regex(
    new RegExp(
      `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{${String(
        Number(process.env.PASSWORD_MIN_LENGTH || 8),
      )},}$`,
    ),
    'Senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.',
  ),
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  email: z.string().email('E-mail inválido').optional(),
  senha: z.string().optional(),
  nome: z.string().optional(),
});

export type AcceptInviteInputDTO = z.input<typeof acceptInviteInputDTOSchema>;

export const acceptInviteResultDTOSchema = z.object({
  message: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    role: z.string(),
    contaId: z.string().optional(),
    emailVerified: z.boolean().optional(),
  }),
});

export type AcceptInviteResultDTO = z.infer<typeof acceptInviteResultDTOSchema>;

export const usersCountResultDTOSchema = z.object({
  count: z.number().int().nonnegative(),
});

export type UsersCountResultDTO = z.infer<typeof usersCountResultDTOSchema>;

export const updateManagedUserInputDTOSchema = z.object({
  name: z.string().min(2, 'Nome muito curto').optional(),
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});

export type UpdateManagedUserInputDTO = z.input<typeof updateManagedUserInputDTOSchema>;

export const managedUserSummaryDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  status: z.string(),
});

export type ManagedUserSummaryDTO = z.infer<typeof managedUserSummaryDTOSchema>;

export const updateManagedUserResultDTOSchema = z.object({
  user: managedUserSummaryDTOSchema,
});

export type UpdateManagedUserResultDTO = z.infer<typeof updateManagedUserResultDTOSchema>;

export const deleteManagedUserResultDTOSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  hard: z.boolean(),
});

export type DeleteManagedUserResultDTO = z.infer<typeof deleteManagedUserResultDTOSchema>;

export const deleteInviteResultDTOSchema = z.object({
  ok: z.literal(true),
});

export type DeleteInviteResultDTO = z.infer<typeof deleteInviteResultDTOSchema>;

export const disabledRegisterResultDTOSchema = z.object({
  error: z.string(),
});

export type DisabledRegisterResultDTO = z.infer<typeof disabledRegisterResultDTOSchema>;

export const firstRegisterInputDTOSchema = authRegisterInputSchema;

export type FirstRegisterInputDTO = z.input<typeof firstRegisterInputDTOSchema>;

export const firstRegisterResultDTOSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: z.string(),
});

export type FirstRegisterResultDTO = z.infer<typeof firstRegisterResultDTOSchema>;
