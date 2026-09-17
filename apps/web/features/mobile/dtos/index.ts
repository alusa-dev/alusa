import { z } from 'zod';

import { isValidIanaTimeZone } from '@/lib/brazil-iana-timezones';

export const mobileLegacyProfileUpdateInputDTOSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
  })
  .strict();

export const mobileProfileUpdateInputDTOSchema = z
  .object({
    personal: z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        telefone: z.string().trim().max(20).nullable().optional(),
        bio: z.string().trim().max(280).nullable().optional(),
      })
      .strict()
      .optional(),
    school: z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        cpfCnpj: z.string().trim().optional(),
        timezone: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine(isValidIanaTimeZone, 'Fuso horário inválido')
          .optional(),
        address: z
          .object({
            street: z.string().trim().max(120).optional(),
            number: z.string().trim().max(20).optional(),
            neighborhood: z.string().trim().max(80).optional(),
            city: z.string().trim().max(80).optional(),
            state: z.string().trim().max(2).optional(),
            cep: z
              .string()
              .trim()
              .refine((value) => !value || /^\d{5}-?\d{3}$/.test(value), 'CEP inválido')
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => value.personal !== undefined || value.school !== undefined, {
    message: 'Nenhuma alteração fornecida.',
  });

export type MobileProfileUpdateInputDTO = z.infer<typeof mobileProfileUpdateInputDTOSchema>;
