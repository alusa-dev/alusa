import { z } from 'zod';
import {
  FINANCIAL_POLICY_OVERRIDE_ROLES,
  REMATRICULA_DEBT_SCOPES,
  REMATRICULA_POLICY_PRESETS,
} from '../policy-dependencies';

export const rematriculaPolicyPresetDTOSchema = z.enum(REMATRICULA_POLICY_PRESETS);
export const rematriculaDebtScopeDTOSchema = z.enum(REMATRICULA_DEBT_SCOPES);
export const overrideRoleDTOSchema = z.enum(FINANCIAL_POLICY_OVERRIDE_ROLES);

export const contaFinancialPolicyDTOSchema = z.object({
  preset: rematriculaPolicyPresetDTOSchema,
  debtScope: rematriculaDebtScopeDTOSchema,
  overrideRoles: z.array(overrideRoleDTOSchema).default([]),
  summary: z.string().default(''),
  updatedAt: z.string().nullable().default(null),
});

export const updateContaFinancialPolicyInputDTOSchema = contaFinancialPolicyDTOSchema.omit({
  summary: true,
  updatedAt: true,
});

export const contaFinancialPolicyResultDTOSchema = z.object({
  policy: contaFinancialPolicyDTOSchema,
});

export type ContaFinancialPolicyDTO = z.infer<typeof contaFinancialPolicyDTOSchema>;
export type UpdateContaFinancialPolicyInputDTO = z.infer<typeof updateContaFinancialPolicyInputDTOSchema>;
