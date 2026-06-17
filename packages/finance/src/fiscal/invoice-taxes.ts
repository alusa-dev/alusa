import type { AsaasInvoiceTaxesRequest } from '@alusa/asaas';

import {
  normalizeOperationPisCofinsRates,
  normalizePisCofinsTaxRates,
  normalizePisCofinsTaxStatus,
  validatePisCofinsTaxRules,
  type PisCofinsTaxRuleIssue,
} from './pis-cofins-tax-status';

export type BuildAsaasInvoiceTaxesInput = {
  simplesNacional: boolean;
  useNationalPortal?: boolean | null;
  retainIss: boolean;
  iss: number;
  pis: number | null;
  cofins: number | null;
  csll: number;
  inss: number;
  ir: number;
  nbsCode?: string | null;
  taxSituationCode?: string | null;
  taxClassificationCode?: string | null;
  operationIndicatorCode?: string | null;
  pisCofinsTaxStatus?: string | null;
  operationPis?: number | null;
  operationCofins?: number | null;
  useTaxSystemReformNT007?: boolean;
};

function optionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNumber(value: number | null | undefined): number | undefined {
  return value == null ? undefined : value;
}

export function validateAsaasInvoiceTaxesInput(
  input: BuildAsaasInvoiceTaxesInput,
): PisCofinsTaxRuleIssue[] {
  return validatePisCofinsTaxRules({
    simplesNacional: input.simplesNacional,
    useNationalPortal: Boolean(input.useNationalPortal),
    pisCofinsTaxStatus: input.pisCofinsTaxStatus,
    pis: input.pis,
    cofins: input.cofins,
    operationPis: input.operationPis,
    operationCofins: input.operationCofins,
  });
}

export function buildAsaasInvoiceTaxes(
  input: BuildAsaasInvoiceTaxesInput,
): AsaasInvoiceTaxesRequest {
  const retainedRates = normalizePisCofinsTaxRates({
    pis: input.pis,
    cofins: input.cofins,
  });
  const pisCofinsTaxStatus = input.simplesNacional
    ? null
    : normalizePisCofinsTaxStatus(input.pisCofinsTaxStatus);
  const operationRates = input.simplesNacional
    ? { operationPis: null, operationCofins: null }
    : normalizeOperationPisCofinsRates({
        pisCofinsTaxStatus,
        operationPis: input.operationPis,
        operationCofins: input.operationCofins,
      });
  const useTaxSystemReformNT007 = input.simplesNacional ? undefined : true;

  return {
    retainIss: input.retainIss,
    iss: input.iss,
    pis: retainedRates.pis,
    cofins: retainedRates.cofins,
    csll: input.csll,
    inss: input.inss,
    ir: input.ir,
    nbsCode: optionalString(input.nbsCode),
    taxSituationCode: optionalString(input.taxSituationCode),
    taxClassificationCode: optionalString(input.taxClassificationCode),
    operationIndicatorCode: optionalString(input.operationIndicatorCode),
    pisCofinsTaxStatus: pisCofinsTaxStatus ?? undefined,
    operationPis: optionalNumber(operationRates.operationPis),
    operationCofins: optionalNumber(operationRates.operationCofins),
    useTaxSystemReformNT007,
  };
}
