import type { AsaasInvoiceTaxesRequest } from '@alusa/asaas';
import { isTaxReformApplicable } from './ibs-cbs';

import {
  normalizeOperationPisCofinsRates,
  normalizePisCofinsTaxRates,
  normalizePisCofinsTaxStatus,
  validatePisCofinsTaxRules,
  type PisCofinsTaxRuleIssue,
} from './pis-cofins-tax-status';

export type BuildAsaasInvoiceTaxesInput = {
  simplesNacional: boolean;
  effectiveDate?: string;
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
};

function optionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
  const includeTaxReformFields = input.effectiveDate
    ? isTaxReformApplicable({
        simplesNacional: input.simplesNacional,
        effectiveDate: input.effectiveDate,
      })
    : false;
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
  const nbsCode = optionalString(input.nbsCode);
  const taxSituationCode = optionalString(input.taxSituationCode);
  const taxClassificationCode = optionalString(input.taxClassificationCode);
  const operationIndicatorCode = optionalString(input.operationIndicatorCode);
  return {
    retainIss: input.retainIss,
    iss: input.iss,
    pis: retainedRates.pis,
    cofins: retainedRates.cofins,
    csll: input.csll,
    inss: input.inss,
    ir: input.ir,
    ...(includeTaxReformFields
      ? {
          ...(nbsCode ? { nbsCode } : {}),
          ...(taxSituationCode ? { taxSituationCode } : {}),
          ...(taxClassificationCode ? { taxClassificationCode } : {}),
          ...(operationIndicatorCode ? { operationIndicatorCode } : {}),
        }
      : {}),
    pisCofinsTaxStatus,
    operationPis: operationRates.operationPis,
    operationCofins: operationRates.operationCofins,
  };
}
