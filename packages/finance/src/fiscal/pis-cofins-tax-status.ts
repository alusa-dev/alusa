/**
 * Valores oficiais de `pisCofinsTaxStatus` conforme guia Asaas:
 * https://docs.asaas.com/docs/configurações-de-retenção-e-situação-tributária-de-piscofins
 */
export const PIS_COFINS_TAX_STATUS_OPTIONS = [
  { value: 'NONE', code: '00', label: 'Nenhum' },
  {
    value: 'STANDARD_TAXABLE_OPERATION',
    code: '01',
    label: 'Operação Tributável com Alíquota Básica',
  },
  {
    value: 'DIFFERENTIATED_RATE_TAXABLE_OPERATION',
    code: '02',
    label: 'Operação Tributável com Alíquota Diferenciada',
  },
  {
    value: 'TAXABLE_PER_MEASURE_UNIT_OPERATION',
    code: '03',
    label: 'Operação Tributável com Alíquota por Unidade de Medida de Produto',
  },
  {
    value: 'MONOPHASIC_RESALE_ZERO_RATE_OPERATION',
    code: '04',
    label: 'Operação Tributável monofásica - Revenda a Alíquota Zero',
  },
  {
    value: 'TAX_SUBSTITUTION_OPERATION',
    code: '05',
    label: 'Operação Tributável por Substituição Tributária',
  },
  {
    value: 'ZERO_RATE_TAXABLE_OPERATION',
    code: '06',
    label: 'Operação Tributável a Alíquota Zero',
  },
  {
    value: 'EXEMPT_CONTRIBUTION_OPERATION',
    code: '07',
    label: 'Operação Isenta da Contribuição',
  },
  {
    value: 'NON_TAXABLE_OPERATION',
    code: '08',
    label: 'Operação sem Incidência da Contribuição',
  },
  {
    value: 'TAX_SUSPENSION_OPERATION',
    code: '09',
    label: 'Operação com Suspensão da Contribuição',
  },
  { value: 'OTHER_OUTPUT_OPERATION', code: '49', label: 'Outras Operações de Saída' },
  {
    value: 'CREDITABLE_EXCLUSIVE_TAXED_DOMESTIC_REVENUE_OPERATION',
    code: '50',
    label: 'Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Tributada no Mercado Interno',
  },
  {
    value: 'CREDITABLE_EXCLUSIVE_NON_TAXED_DOMESTIC_REVENUE_OPERATION',
    code: '51',
    label: 'Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Não-Tributada no Mercado Interno',
  },
  {
    value: 'CREDITABLE_EXPORT_REVENUE_OPERATION',
    code: '52',
    label: 'Operação com Direito a Crédito - Vinculada Exclusivamente a Receita de Exportação',
  },
  {
    value: 'CREDITABLE_TAXED_AND_NON_TAXED_DOMESTIC_REVENUE_OPERATION',
    code: '53',
    label: 'Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno',
  },
  {
    value: 'CREDITABLE_TAXED_DOMESTIC_AND_EXPORT_REVENUE_OPERATION',
    code: '54',
    label: 'Operação com Direito a Crédito - Vinculada a Receitas Tributadas no Mercado Interno e de Exportação',
  },
  {
    value: 'CREDITABLE_NON_TAXED_DOMESTIC_AND_EXPORT_REVENUE_OPERATION',
    code: '55',
    label: 'Operação com Direito a Crédito - Vinculada a Receitas Não Tributadas no Mercado Interno e de Exportação',
  },
  {
    value: 'CREDITABLE_TAXED_AND_NON_TAXED_DOMESTIC_AND_EXPORT_REVENUE_OPERATION',
    code: '56',
    label: 'Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno e de Exportação',
  },
  {
    value: 'PRESUMED_CREDIT_EXCLUSIVE_TAXED_DOMESTIC_REVENUE_OPERATION',
    code: '60',
    label: 'Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Tributada no Mercado Interno',
  },
  {
    value: 'PRESUMED_CREDIT_EXCLUSIVE_NON_TAXED_DOMESTIC_REVENUE_OPERATION',
    code: '61',
    label: 'Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Não-Tributada no Mercado Interno',
  },
  {
    value: 'PRESUMED_CREDIT_EXCLUSIVE_EXPORT_REVENUE_OPERATION',
    code: '62',
    label: 'Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita de Exportação',
  },
  {
    value: 'PRESUMED_CREDIT_TAXED_AND_NON_TAXED_DOMESTIC_REVENUE_OPERATION',
    code: '63',
    label: 'Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno',
  },
  {
    value: 'PRESUMED_CREDIT_TAXED_DOMESTIC_AND_EXPORT_REVENUE_OPERATION',
    code: '64',
    label: 'Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas no Mercado Interno e de Exportação',
  },
  {
    value: 'PRESUMED_CREDIT_NON_TAXED_DOMESTIC_AND_EXPORT_REVENUE_OPERATION',
    code: '65',
    label: 'Crédito Presumido - Operação de Aquisição Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação',
  },
  {
    value: 'PRESUMED_CREDIT_TAXED_AND_NON_TAXED_DOMESTIC_AND_EXPORT_REVENUE_OPERATION',
    code: '66',
    label: 'Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno e de Exportação',
  },
  {
    value: 'PRESUMED_CREDIT_OTHER_OPERATION',
    code: '67',
    label: 'Crédito Presumido - Outras Operações',
  },
  {
    value: 'ACQUISITION_WITHOUT_CREDIT_RIGHT_OPERATION',
    code: '70',
    label: 'Operação de Aquisição sem Direito a Crédito',
  },
  {
    value: 'ACQUISITION_WITH_EXEMPTION_OPERATION',
    code: '71',
    label: 'Operação de Aquisição com Isenção',
  },
  {
    value: 'ACQUISITION_WITH_SUSPENSION_OPERATION',
    code: '72',
    label: 'Operação de Aquisição com Suspensão',
  },
  {
    value: 'ACQUISITION_ZERO_RATE_OPERATION',
    code: '73',
    label: 'Operação de Aquisição a Alíquota Zero',
  },
  {
    value: 'ACQUISITION_WITHOUT_CONTRIBUTION_OPERATION',
    code: '74',
    label: 'Operação de Aquisição sem Incidência da Contribuição',
  },
  {
    value: 'ACQUISITION_BY_TAX_SUBSTITUTION_OPERATION',
    code: '75',
    label: 'Operação de Aquisição por Substituição Tributária',
  },
  { value: 'OTHER_INPUT_OPERATION', code: '98', label: 'Outras Operações de Entrada' },
  { value: 'OTHER_OPERATION', code: '99', label: 'Outras Operações' },
] as const;

export type PisCofinsTaxStatus = (typeof PIS_COFINS_TAX_STATUS_OPTIONS)[number]['value'];

export const PIS_COFINS_TAX_STATUS_VALUES = PIS_COFINS_TAX_STATUS_OPTIONS.map(
  (option) => option.value,
) as [PisCofinsTaxStatus, ...PisCofinsTaxStatus[]];

const LABEL_BY_VALUE = new Map(
  PIS_COFINS_TAX_STATUS_OPTIONS.map((option) => [option.value, option.label]),
);

export function getPisCofinsTaxStatusLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return LABEL_BY_VALUE.get(value as PisCofinsTaxStatus) ?? value;
}

export function formatPisCofinsTaxStatusOption(option: (typeof PIS_COFINS_TAX_STATUS_OPTIONS)[number]) {
  return `${option.code} — ${option.label}`;
}

export function filterPisCofinsTaxStatusOptions(query?: string) {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return [...PIS_COFINS_TAX_STATUS_OPTIONS];

  return PIS_COFINS_TAX_STATUS_OPTIONS.filter((option) => {
    const haystack = `${option.value} ${option.code} ${option.label}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

export function isValidPisCofinsTaxStatus(value: string | null | undefined): value is PisCofinsTaxStatus {
  if (!value) return false;
  return LABEL_BY_VALUE.has(value as PisCofinsTaxStatus);
}

/** Descontinuado no guia Asaas — aceito apenas para leitura de registros legados. */
export const LEGACY_PIS_COFINS_TAX_STATUS = 'TAXABLE_CONTRIBUTION_OPERATION' as const;

export function normalizePisCofinsTaxStatus(
  value: string | null | undefined,
): PisCofinsTaxStatus | null {
  if (!value) return null;
  if (value === LEGACY_PIS_COFINS_TAX_STATUS) return 'EXEMPT_CONTRIBUTION_OPERATION';
  return isValidPisCofinsTaxStatus(value) ? value : null;
}

export function isPisCofinsTaxStatusRequired(input: {
  simplesNacional: boolean;
  useNationalPortal?: boolean;
}): boolean {
  return !input.simplesNacional;
}

export type PisCofinsTaxRuleInput = {
  simplesNacional?: boolean;
  useNationalPortal?: boolean;
  pisCofinsTaxStatus?: string | null;
  pis?: number | null;
  cofins?: number | null;
  operationPis?: number | null;
  operationCofins?: number | null;
};

export type PisCofinsTaxRuleIssue = {
  field: 'pisCofinsTaxStatus' | 'pis' | 'cofins' | 'operationPis' | 'operationCofins';
  message: string;
};

const TAX_STATUS_REQUIRING_POSITIVE_RATES = new Set<string>([
  'STANDARD_TAXABLE_OPERATION',
  'DIFFERENTIATED_RATE_TAXABLE_OPERATION',
]);

const TAX_STATUS_REQUIRING_ZERO_RATES = new Set<string>(['ZERO_RATE_TAXABLE_OPERATION']);

const TAX_STATUS_REQUIRING_NULL_RATES = new Set<string>([
  'NONE',
  'NON_TAXABLE_OPERATION',
  'TAX_SUSPENSION_OPERATION',
  'EXEMPT_CONTRIBUTION_OPERATION',
]);

function isPositiveRate(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isZeroRate(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value === 0;
}

function isNullRate(value: number | null | undefined): boolean {
  return value == null;
}

export function validatePisCofinsTaxRules(
  input: PisCofinsTaxRuleInput,
): PisCofinsTaxRuleIssue[] {
  const issues: PisCofinsTaxRuleIssue[] = [];
  const status = normalizePisCofinsTaxStatus(input.pisCofinsTaxStatus);
  const statusRequired = isPisCofinsTaxStatusRequired({
    simplesNacional: input.simplesNacional ?? true,
    useNationalPortal: input.useNationalPortal ?? false,
  });

  if (input.simplesNacional !== false && !status) {
    return issues;
  }

  if (statusRequired && !status) {
    issues.push({
      field: 'pisCofinsTaxStatus',
      message: 'Informe a situação tributária de PIS/COFINS para contas fora do Simples Nacional.',
    });
    return issues;
  }

  if (input.pisCofinsTaxStatus && !status) {
    issues.push({
      field: 'pisCofinsTaxStatus',
      message: 'Situação tributária de PIS/COFINS inválida.',
    });
    return issues;
  }

  if (!status) return issues;

  if (TAX_STATUS_REQUIRING_POSITIVE_RATES.has(status)) {
    if (!isPositiveRate(input.operationPis)) {
      issues.push({
        field: 'operationPis',
        message: 'Informe uma alíquota de operação de PIS maior que zero para esta situação tributária.',
      });
    }
    if (!isPositiveRate(input.operationCofins)) {
      issues.push({
        field: 'operationCofins',
        message: 'Informe uma alíquota de operação de COFINS maior que zero para esta situação tributária.',
      });
    }
  }

  if (TAX_STATUS_REQUIRING_ZERO_RATES.has(status)) {
    if (!isZeroRate(input.operationPis)) {
      issues.push({
        field: 'operationPis',
        message: 'A alíquota de operação de PIS deve ser zero para esta situação tributária.',
      });
    }
    if (!isZeroRate(input.operationCofins)) {
      issues.push({
        field: 'operationCofins',
        message: 'A alíquota de operação de COFINS deve ser zero para esta situação tributária.',
      });
    }
  }

  if (TAX_STATUS_REQUIRING_NULL_RATES.has(status)) {
    if (!isNullRate(input.operationPis)) {
      issues.push({
        field: 'operationPis',
        message: 'A alíquota de operação de PIS deve ficar vazia para esta situação tributária.',
      });
    }
    if (!isNullRate(input.operationCofins)) {
      issues.push({
        field: 'operationCofins',
        message: 'A alíquota de operação de COFINS deve ficar vazia para esta situação tributária.',
      });
    }
  }

  return issues;
}

export function normalizePisCofinsTaxRates(input: {
  pisCofinsTaxStatus?: string | null;
  pis?: number | null;
  cofins?: number | null;
}): { pis: number | null; cofins: number | null } {
  return {
    pis: input.pis ?? null,
    cofins: input.cofins ?? null,
  };
}

export function normalizeOperationPisCofinsRates(input: {
  pisCofinsTaxStatus?: string | null;
  operationPis?: number | null;
  operationCofins?: number | null;
}): { operationPis: number | null; operationCofins: number | null } {
  const status = normalizePisCofinsTaxStatus(input.pisCofinsTaxStatus);
  if (status && TAX_STATUS_REQUIRING_NULL_RATES.has(status)) {
    return { operationPis: null, operationCofins: null };
  }
  if (status && TAX_STATUS_REQUIRING_ZERO_RATES.has(status)) {
    return { operationPis: 0, operationCofins: 0 };
  }
  return {
    operationPis: input.operationPis ?? null,
    operationCofins: input.operationCofins ?? null,
  };
}
