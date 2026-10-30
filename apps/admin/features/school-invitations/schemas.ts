import { z } from 'zod';
import { resolveSchoolCommercialTarget } from '@alusa/platform-billing/commercial-model';

const trialDaysSchema = z.union([z.literal(0), z.literal(7), z.literal(14), z.literal(21), z.literal(30), z.literal(60), z.literal(90)]);
const planCodeSchema = z.enum([
  'BAND_001_025', 'BAND_026_050', 'BAND_051_100', 'BAND_101_150',
  'BAND_151_200', 'BAND_201_300', 'BAND_301_400', 'BAND_401_500',
]);

export const invitationCreateSchema = z.object({
  schoolName: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  conditionType: z.enum(['STANDARD', 'CUSTOM']),
  studentCount: z.number().int().min(1).max(100000),
  planCode: planCodeSchema.optional(),
  customBaseMonthlyAmountCents: z.number().int().min(1).max(100_000_000).optional(),
  customIncludedStudentCount: z.number().int().min(1).max(100_000).optional(),
  customMonthlyOverageAmountCents: z.number().int().min(1).max(100_000_000).optional(),
  trialDays: trialDaysSchema.default(14),
  expirationHours: z.number().int().min(1).max(720).default(72),
}).superRefine((value, ctx) => {
  if (value.conditionType === 'STANDARD' && value.studentCount > 500) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['conditionType'], message: 'Acima de 500 alunos, use condição personalizada e atendimento especializado.' });
  }
  if (value.conditionType === 'CUSTOM' && (value.customBaseMonthlyAmountCents === undefined || value.customIncludedStudentCount === undefined || value.customMonthlyOverageAmountCents === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customBaseMonthlyAmountCents'], message: 'Condição personalizada exige valor base, alunos incluídos e taxa mensal por aluno excedente.' });
  }
}).transform((value) => {
  if (value.conditionType !== 'STANDARD') return { ...value, planCode: undefined };
  const target = resolveSchoolCommercialTarget(value.studentCount);
  return { ...value, planCode: target?.kind === 'SELF_SERVICE' ? target.band.code : undefined };
});

export const invitationUpdateSchema = z.object({
  schoolName: z.string().trim().min(2).max(160).optional(),
  contactName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  conditionType: z.enum(['STANDARD', 'CUSTOM']).optional(),
  studentCount: z.number().int().min(1).max(100000).optional(),
  planCode: planCodeSchema.nullable().optional(),
  customBaseMonthlyAmountCents: z.number().int().min(1).max(100_000_000).nullable().optional(),
  customIncludedStudentCount: z.number().int().min(1).max(100_000).nullable().optional(),
  customMonthlyOverageAmountCents: z.number().int().min(1).max(100_000_000).nullable().optional(),
  trialDays: trialDaysSchema.optional(),
  expirationHours: z.number().int().min(1).max(720).optional(),
  action: z.enum(['UPDATE', 'REVOKE']).default('UPDATE'),
}).superRefine((value, ctx) => {
  if (value.conditionType === 'STANDARD' && value.studentCount !== undefined && value.studentCount > 500) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['conditionType'], message: 'Acima de 500 alunos, use condição personalizada e atendimento especializado.' });
  }
  if (value.conditionType === 'CUSTOM' && (value.customBaseMonthlyAmountCents == null || value.customIncludedStudentCount == null || value.customMonthlyOverageAmountCents == null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customBaseMonthlyAmountCents'], message: 'Informe o valor base, alunos incluídos e taxa mensal por aluno excedente.' });
  }
}).transform((value) => {
  if (value.conditionType === 'CUSTOM') return { ...value, planCode: null };
  if (value.conditionType === 'STANDARD' && value.studentCount !== undefined) {
    const target = resolveSchoolCommercialTarget(value.studentCount);
    return { ...value, planCode: target?.kind === 'SELF_SERVICE' ? target.band.code : null };
  }
  return value;
});
