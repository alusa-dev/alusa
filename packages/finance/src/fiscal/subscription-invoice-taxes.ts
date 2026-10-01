import { buildAsaasInvoiceTaxes } from './invoice-taxes';

export type SubscriptionFiscalTaxSource = {
  simplesNacional: boolean;
  useNationalPortal?: boolean | null;
  retainIss: boolean;
  iss: unknown;
  pis: unknown;
  cofins: unknown;
  csll: unknown;
  inss: unknown;
  ir: unknown;
  nbsCode: string | null;
  taxSituationCode: string | null;
  taxClassificationCode: string | null;
  operationIndicatorCode: string | null;
  pisCofinsTaxStatus: string | null;
  operationPis: unknown;
  operationCofins: unknown;
};

function asNumber(value: unknown): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildSubscriptionInvoiceTaxes(
  service: SubscriptionFiscalTaxSource,
  effectiveDate: string,
): ReturnType<typeof buildAsaasInvoiceTaxes> {
  return buildAsaasInvoiceTaxes({
    simplesNacional: service.simplesNacional,
    effectiveDate,
    useNationalPortal: service.useNationalPortal,
    retainIss: service.retainIss,
    iss: asNumber(service.iss),
    pis: service.pis == null ? null : asNumber(service.pis),
    cofins: service.cofins == null ? null : asNumber(service.cofins),
    csll: asNumber(service.csll),
    inss: asNumber(service.inss),
    ir: asNumber(service.ir),
    nbsCode: service.nbsCode,
    taxSituationCode: service.taxSituationCode,
    taxClassificationCode: service.taxClassificationCode,
    operationIndicatorCode: service.operationIndicatorCode,
    pisCofinsTaxStatus: service.pisCofinsTaxStatus,
    operationPis: service.operationPis == null ? null : asNumber(service.operationPis),
    operationCofins: service.operationCofins == null ? null : asNumber(service.operationCofins),
  });
}
