import { z } from 'zod';
import { isValidCpfCnpjDigits, normalizeCpfCnpjDigits } from '@alusa/lib/cpf-cnpj';
import { isAtLeastAgeYears, isValidDateOnly } from '@alusa/lib/date-only';
import { LEGAL_DOCUMENTS } from '@/lib/privacy/legal-versions';

const passwordMinLength = Number(process.env.PASSWORD_MIN_LENGTH || 8);
const passwordMessage =
  'Senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';
const passwordRegex = new RegExp(
  '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{' + String(passwordMinLength) + ',}$',
);

export const financeIntegrationModeSchema = z.enum(['WHITELABEL_BAAS', 'EXTERNAL_ASAAS_ACCOUNT']);

const legalDocumentTypeSchema = z.enum([
  'TERMS_OF_USE',
  'PRIVACY_POLICY',
  'DPA',
  'ASAAS_FINANCIAL_SERVICES',
]);

export const legalAcceptanceInputSchema = z.object({
  accepted: z.literal(true),
  locale: z.string().trim().min(2).max(16).default('pt-BR'),
  source: z.enum(['REGISTER', 'ONBOARDING', 'REACCEPTANCE']).default('REGISTER'),
  documents: z
    .array(
      z.object({
        documentType: legalDocumentTypeSchema,
        documentVersion: z.string().trim().min(1).max(32),
      }),
    )
    .min(3)
    .refine(
      (documents) => {
        const accepted = new Map(documents.map((document) => [document.documentType, document.documentVersion]));
        return LEGAL_DOCUMENTS
          .filter((document) =>
            document.type === 'TERMS_OF_USE' ||
            document.type === 'PRIVACY_POLICY' ||
            document.type === 'DPA',
          )
          .every((document) => accepted.get(document.type) === document.version);
      },
      { message: 'Aceite legal obrigatório ausente ou desatualizado.' },
    ),
});

export const authRegisterInputSchema = z.object({
  escolaNome: z.string().min(2),
  cpfCnpj: z
    .string()
    .transform((v) => normalizeCpfCnpjDigits(v))
    .refine((v) => isValidCpfCnpjDigits(v), 'CPF/CNPJ inválido')
    .optional(),
  nome: z.string().min(2),
  email: z.string().email(),
  financeIntegrationMode: financeIntegrationModeSchema.optional().default('WHITELABEL_BAAS'),
  birthDate: z
    .string()
    .min(1)
    .refine((v) => isValidDateOnly(v), 'Data inválida')
    .refine((v) => isAtLeastAgeYears(v, 18), 'É necessário ter 18 anos ou mais')
    .optional(),
  senha: z.string().regex(passwordRegex, passwordMessage),
  legalAcceptance: legalAcceptanceInputSchema,
});

export type AuthRegisterInputDTO = z.infer<typeof authRegisterInputSchema>;
