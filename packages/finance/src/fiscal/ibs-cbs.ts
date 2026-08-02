import type { AsaasInvoiceIbsCbsRequest } from '@alusa/asaas';

export type FiscalIbsCbsSource = {
  nbsCode?: string | null;
  nationalTaxCode?: string | null;
  taxSituationCode?: string | null;
  taxClassificationCode?: string | null;
  operationIndicatorCode?: string | null;
};

export type FiscalIbsCbsIssue = { field: keyof FiscalIbsCbsSource; message: string };

const requiredFields: Array<keyof FiscalIbsCbsSource> = [
  'nbsCode',
  'nationalTaxCode',
  'taxSituationCode',
  'taxClassificationCode',
  'operationIndicatorCode',
];

export function validateFiscalIbsCbs(source: FiscalIbsCbsSource): FiscalIbsCbsIssue[] {
  return requiredFields.flatMap((field) =>
    source[field]?.trim()
      ? []
      : [{ field, message: `Informe ${field} para emissão IBS/CBS.` }],
  );
}

export function buildAsaasInvoiceIbsCbs(
  source: FiscalIbsCbsSource,
): AsaasInvoiceIbsCbsRequest | null {
  if (validateFiscalIbsCbs(source).length > 0) return null;
  return {
    nbsCode: source.nbsCode!.trim(),
    nationalServiceCode: source.nationalTaxCode!.trim(),
    taxSituation: source.taxSituationCode!.trim(),
    taxClassification: source.taxClassificationCode!.trim(),
    operationIndicatorCode: source.operationIndicatorCode!.trim(),
  };
}
