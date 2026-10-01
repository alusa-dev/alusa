export type FiscalIbsCbsSource = {
  nbsCode?: string | null;
  taxSituationCode?: string | null;
  taxClassificationCode?: string | null;
  operationIndicatorCode?: string | null;
};

export type FiscalIbsCbsIssue = { field: keyof FiscalIbsCbsSource; message: string };

const requiredFields: Array<keyof FiscalIbsCbsSource> = [
  'nbsCode',
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

/** Uses only the tenant-declared regime and invoice date. Activity-specific
 * scenarios are not inferred from codes the current model does not classify. */
export function isTaxReformApplicable(input: {
  simplesNacional: boolean;
  effectiveDate: string;
}): boolean {
  const startDate = input.simplesNacional ? '2027-01-01' : '2026-10-01';
  return input.effectiveDate >= startDate;
}
