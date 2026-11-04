import { z } from 'zod';
import { isValidIanaTimeZone } from '@/lib/brazil-iana-timezones';
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
  street: z.string(), number: z.string(), district: z.string(), city: z.string(), state: z.string(), cep: z.string(),
});
export type UserSchoolAddressDTO = z.infer<typeof userSchoolAddressDTOSchema>;

export const userSchoolSummaryDTOSchema = z.object({
  id: z.string(), name: z.string(), cpfCnpj: z.string().nullable().optional(), status: z.string(),
  ownerUserId: z.string().nullable().optional(), timezone: z.string(), address: userSchoolAddressDTOSchema.optional(),
});
export type UserSchoolSummaryDTO = z.infer<typeof userSchoolSummaryDTOSchema>;

export const userSchoolProfileDTOSchema = userSchoolSummaryDTOSchema.extend({ address: userSchoolAddressDTOSchema });
export type UserSchoolProfileDTO = z.infer<typeof userSchoolProfileDTOSchema>;

export const userProfileDTOSchema = z.object({
  id: z.string(), name: z.string(), email: z.string().email(), role: z.string(),
  telefone: z.string().nullable().optional(), foto: z.string().nullable().optional(), bio: z.string().nullable().optional(),
  locale: z.enum(PROFILE_LOCALE_VALUES), theme: z.enum(PROFILE_THEME_VALUES),
  notifications: notificationPreferencesDTOSchema,
});
export type UserProfileDTO = z.infer<typeof userProfileDTOSchema>;

export const userProfileWithSchoolDTOSchema = userProfileDTOSchema.extend({ school: userSchoolProfileDTOSchema.nullable() });
export type UserProfileWithSchoolDTO = z.infer<typeof userProfileWithSchoolDTOSchema>;

export const welcomeWizardStatusDTOSchema = z.object({ shouldShow: z.boolean(), seenAt: dateLikeDTOSchema.nullable() });
export type WelcomeWizardStatusDTO = z.infer<typeof welcomeWizardStatusDTOSchema>;

export const updateCurrentProfileInputDTOSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120, 'Nome muito longo').optional(),
  telefone: z.string().trim().max(20, 'Telefone invalido').optional(),
  foto: z.union([
    z.string().trim().refine((value) => /^https?:\/\//i.test(value) || value.startsWith('/uploads/') || value.startsWith('/api/files/'), 'URL invalida'),
    z.literal(null),
  ]).optional(),
  bio: z.string().trim().max(280, 'Bio deve ter no maximo 280 caracteres').optional(),
  locale: z.enum(PROFILE_LOCALE_VALUES).optional(), theme: z.enum(PROFILE_THEME_VALUES).optional(),
}).strict();
export type UpdateCurrentProfileInputDTO = z.input<typeof updateCurrentProfileInputDTOSchema>;

export const changeEmailInputDTOSchema = z.object({
  newEmail: z.string().email('Email invalido').transform((value) => value.trim().toLowerCase()),
  currentPassword: z.string().min(1, 'Senha atual obrigatoria'),
});
export type ChangeEmailInputDTO = z.input<typeof changeEmailInputDTOSchema>;
export const changeEmailResultDTOSchema = z.object({ success: z.literal(true), email: z.string().email() });
export type ChangeEmailResultDTO = z.infer<typeof changeEmailResultDTOSchema>;

export const simpleSuccessResultDTOSchema = z.object({ success: z.literal(true) });
export type SimpleSuccessResultDTO = z.infer<typeof simpleSuccessResultDTOSchema>;

export const updateNotificationPreferencesInputDTOSchema = notificationPreferencesDTOSchema;
export type UpdateNotificationPreferencesInputDTO = z.input<typeof updateNotificationPreferencesInputDTOSchema>;
export const updateNotificationPreferencesResultDTOSchema = z.object({ notifications: notificationPreferencesDTOSchema });
export type UpdateNotificationPreferencesResultDTO = z.infer<typeof updateNotificationPreferencesResultDTOSchema>;

export const updateSchoolInputDTOSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto').max(120, 'Nome muito longo').optional(),
  cpfCnpj: z.string().trim().regex(/^[0-9.\-/]{11,18}$/i, 'CNPJ/CPF inválido').optional(),
  timezone: z.string().trim().min(1).optional().refine((value) => value === undefined || isValidIanaTimeZone(value), {
    message: 'Fuso horário IANA inválido',
  }),
}).strict();
export type UpdateSchoolInputDTO = z.input<typeof updateSchoolInputDTOSchema>;

export const updateSchoolAddressInputDTOSchema = z.object({
  street: z.string().trim().max(120).optional(), number: z.string().trim().max(20).optional(),
  district: z.string().trim().max(80).optional(), city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(2).optional(), cep: z.string().trim().regex(/^\d{5}-?\d{3}$/).optional(),
}).strict();
export type UpdateSchoolAddressInputDTO = z.input<typeof updateSchoolAddressInputDTOSchema>;

