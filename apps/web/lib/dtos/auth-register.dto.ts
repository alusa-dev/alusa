import { z } from 'zod';
import { isAtLeastAgeYears, isValidCpfCnpjDigits, isValidDateOnly, normalizeCpfCnpjDigits } from '@alusa/lib';

const passwordMinLength = Number(process.env.PASSWORD_MIN_LENGTH || 8);
const passwordMessage =
  'Senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';
const passwordRegex = new RegExp(
  '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{' + String(passwordMinLength) + ',}$',
);

export const authRegisterInputSchema = z.object({
  escolaNome: z.string().min(2),
  cpfCnpj: z
    .string()
    .transform((v) => normalizeCpfCnpjDigits(v))
    .refine((v) => isValidCpfCnpjDigits(v), 'CPF/CNPJ inválido')
    .optional(),
  nome: z.string().min(2),
  email: z.string().email(),
  birthDate: z
    .string()
    .min(1)
    .refine((v) => isValidDateOnly(v), 'Data inválida')
    .refine((v) => isAtLeastAgeYears(v, 18), 'É necessário ter 18 anos ou mais')
    .optional(),
  senha: z.string().regex(passwordRegex, passwordMessage),
});

export type AuthRegisterInputDTO = z.infer<typeof authRegisterInputSchema>;
