import { z } from 'zod';

const cepRegex = /^\d{8}$/;
const ufRegex = /^[A-Z]{2}$/;

export type PayerAddressRecord = {
  enderecoCep?: string | null;
  enderecoLogradouro?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoBairro?: string | null;
  enderecoCidade?: string | null;
  enderecoUf?: string | null;
};

export type NormalizedPayerAddress = {
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type PayerAddressIssue = {
  code: string;
  message: string;
};

export type PayerAddressFlatInput = {
  enderecoCep?: string | null;
  enderecoLogradouro?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoBairro?: string | null;
  enderecoCidade?: string | null;
  enderecoUf?: string | null;
};

export type PayerAddressNestedInput = {
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
};

export function digitsOnly(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\D/g, '');
}

export function trimOrUndefined(value: unknown): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRepeatedDigits(value: string): boolean {
  return /^(\d)\1+$/.test(value);
}

export function payerAddressFromRecord(record: PayerAddressRecord): PayerAddressFlatInput {
  return {
    enderecoCep: record.enderecoCep,
    enderecoLogradouro: record.enderecoLogradouro,
    enderecoNumero: record.enderecoNumero,
    enderecoComplemento: record.enderecoComplemento,
    enderecoBairro: record.enderecoBairro,
    enderecoCidade: record.enderecoCidade,
    enderecoUf: record.enderecoUf,
  };
}

export function buildResponsavelEnderecoFromFlat(
  flat: PayerAddressFlatInput | null | undefined,
): PayerAddressNestedInput | undefined {
  if (!flat) return undefined;

  const cep = digitsOnly(flat.enderecoCep);
  const numero = trimOrUndefined(flat.enderecoNumero);
  const logradouro = trimOrUndefined(flat.enderecoLogradouro);
  const bairro = trimOrUndefined(flat.enderecoBairro);
  const cidade = trimOrUndefined(flat.enderecoCidade);
  const uf = trimOrUndefined(flat.enderecoUf)?.toUpperCase();
  const complemento = trimOrUndefined(flat.enderecoComplemento);

  const hasAny = Boolean(cep || numero || logradouro || bairro || cidade || uf || complemento);
  if (!hasAny) return undefined;

  return {
    cep: cep || undefined,
    logradouro,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
  };
}

export function normalizePayerAddressInput(
  input: PayerAddressNestedInput | null | undefined,
): NormalizedPayerAddress | null {
  if (!input) return null;

  const cep = digitsOnly(input.cep);
  const numero = trimOrUndefined(input.numero);
  const logradouro = trimOrUndefined(input.logradouro);
  const bairro = trimOrUndefined(input.bairro);
  const cidade = trimOrUndefined(input.cidade);
  const uf = trimOrUndefined(input.uf)?.toUpperCase();
  const complemento = trimOrUndefined(input.complemento);

  const hasAny = Boolean(cep || numero || logradouro || bairro || cidade || uf || complemento);
  if (!hasAny) return null;

  return {
    cep,
    logradouro: logradouro ?? '',
    numero: numero ?? '',
    complemento,
    bairro: bairro ?? '',
    cidade: cidade ?? '',
    uf: uf ?? '',
  };
}

export function evaluatePayerAddressFiscalReadiness(
  input: PayerAddressRecord | PayerAddressNestedInput | PayerAddressFlatInput | null | undefined,
): { ready: boolean; issues: PayerAddressIssue[] } {
  const nested =
    input && 'enderecoCep' in input
      ? buildResponsavelEnderecoFromFlat(input as PayerAddressFlatInput)
      : (input as PayerAddressNestedInput | null | undefined);

  const normalized = normalizePayerAddressInput(nested);
  const issues: PayerAddressIssue[] = [];

  if (!normalized) {
    issues.push({
      code: 'PAYER_ADDRESS_MISSING',
      message: 'Endereço do responsável financeiro não informado.',
    });
    return { ready: false, issues };
  }

  if (!cepRegex.test(normalized.cep)) {
    issues.push({
      code: 'PAYER_ADDRESS_CEP_INVALID',
      message: 'CEP do responsável deve ter 8 dígitos.',
    });
  } else if (isRepeatedDigits(normalized.cep)) {
    issues.push({
      code: 'PAYER_ADDRESS_CEP_INVALID',
      message: 'CEP do responsável é inválido.',
    });
  }

  if (!normalized.numero) {
    issues.push({
      code: 'PAYER_ADDRESS_NUMBER_MISSING',
      message: 'Informe o número do endereço do responsável.',
    });
  }

  if (!normalized.logradouro || normalized.logradouro.length < 2) {
    issues.push({
      code: 'PAYER_ADDRESS_STREET_MISSING',
      message: 'Informe o logradouro do responsável.',
    });
  }

  if (!normalized.bairro || normalized.bairro.length < 2) {
    issues.push({
      code: 'PAYER_ADDRESS_NEIGHBORHOOD_MISSING',
      message: 'Informe o bairro do responsável.',
    });
  }

  if (!normalized.cidade || normalized.cidade.length < 2) {
    issues.push({
      code: 'PAYER_ADDRESS_CITY_MISSING',
      message: 'Informe a cidade do responsável.',
    });
  }

  if (!normalized.uf || !ufRegex.test(normalized.uf)) {
    issues.push({
      code: 'PAYER_ADDRESS_UF_INVALID',
      message: 'Informe a UF do responsável (2 letras).',
    });
  }

  return { ready: issues.length === 0, issues };
}

export type PayerAddressReadinessCalloutContext = 'responsavel-form' | 'charge-action';

export function getPayerAddressReadinessCalloutCopy(
  issues: PayerAddressIssue[],
  context: PayerAddressReadinessCalloutContext = 'responsavel-form',
): { label: string; detail: string } {
  const issue = issues[0];

  if (!issue) {
    return {
      label: 'Endereço incompleto',
      detail:
        context === 'responsavel-form'
          ? 'Preencha o endereço abaixo para habilitar cobranças e NFS-e.'
          : 'Complete o endereço do responsável financeiro.',
    };
  }

  const formActionHint =
    context === 'responsavel-form' ? ' Preencha os campos abaixo para habilitar cobranças e NFS-e.' : '';

  switch (issue.code) {
    case 'PAYER_ADDRESS_MISSING':
      return {
        label: 'Endereço não informado',
        detail:
          context === 'responsavel-form'
            ? 'Preencha os campos abaixo para habilitar cobranças e NFS-e.'
            : 'Complete o endereço e o CEP do responsável financeiro para emitir a NFS-e.',
      };
    case 'PAYER_ADDRESS_CEP_INVALID':
      return {
        label: 'CEP inválido',
        detail: issue.message.includes('8 dígitos')
          ? `Informe um CEP com 8 dígitos.${formActionHint}`
          : `Revise o CEP informado.${formActionHint}`,
      };
    case 'PAYER_ADDRESS_NUMBER_MISSING':
      return {
        label: 'Número do endereço ausente',
        detail: `Informe o número do endereço.${formActionHint}`,
      };
    case 'PAYER_ADDRESS_STREET_MISSING':
      return {
        label: 'Logradouro ausente',
        detail: `Informe o logradouro.${formActionHint}`,
      };
    case 'PAYER_ADDRESS_NEIGHBORHOOD_MISSING':
      return {
        label: 'Bairro ausente',
        detail: `Informe o bairro.${formActionHint}`,
      };
    case 'PAYER_ADDRESS_CITY_MISSING':
      return {
        label: 'Cidade ausente',
        detail: `Informe a cidade.${formActionHint}`,
      };
    case 'PAYER_ADDRESS_UF_INVALID':
      return {
        label: 'UF inválida',
        detail: `Informe a UF com 2 letras.${formActionHint}`,
      };
    case 'ASAAS_CUSTOMER_ADDRESS':
      return {
        label: 'Emissão bloqueada por endereço',
        detail:
          context === 'charge-action'
            ? 'Complete o endereço e o CEP do responsável financeiro para emitir a NFS-e.'
            : issue.message,
      };
    default:
      return {
        label: 'Endereço incompleto',
        detail: issue.message,
      };
  }
}

export function assertPayerAddressFiscalReady(
  input: PayerAddressRecord | PayerAddressNestedInput | PayerAddressFlatInput | null | undefined,
): NormalizedPayerAddress {
  const readiness = evaluatePayerAddressFiscalReadiness(input);
  if (!readiness.ready) {
    throw new Error(readiness.issues[0]?.message ?? 'Endereço do responsável incompleto.');
  }

  const nested =
    input && 'enderecoCep' in input
      ? buildResponsavelEnderecoFromFlat(input as PayerAddressFlatInput)
      : (input as PayerAddressNestedInput | null | undefined);

  return normalizePayerAddressInput(nested)!;
}

export const responsavelEnderecoInputSchema = z.object({
  cep: z.preprocess(
    (value) => digitsOnly(value),
    z.string().regex(cepRegex, 'CEP deve ter 8 dígitos').refine((v) => !isRepeatedDigits(v), 'CEP inválido'),
  ),
  logradouro: z.string().trim().min(2, 'Logradouro obrigatório'),
  numero: z.string().trim().min(1, 'Número obrigatório'),
  complemento: z.preprocess(trimOrUndefined, z.string().optional()),
  bairro: z.string().trim().min(2, 'Bairro obrigatório'),
  cidade: z.string().trim().min(2, 'Cidade obrigatória'),
  uf: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => ufRegex.test(value), 'UF inválida'),
});

export type ResponsavelEnderecoInput = z.infer<typeof responsavelEnderecoInputSchema>;

export function mapNormalizedAddressToResponsavelColumns(address: NormalizedPayerAddress) {
  return {
    enderecoCep: address.cep,
    enderecoLogradouro: address.logradouro,
    enderecoNumero: address.numero,
    enderecoComplemento: address.complemento ?? null,
    enderecoBairro: address.bairro,
    enderecoCidade: address.cidade,
    enderecoUf: address.uf,
  };
}

export function mapNormalizedAddressToAsaasCustomerFields(address: NormalizedPayerAddress) {
  return {
    postalCode: address.cep,
    addressNumber: address.numero,
    address: address.logradouro,
    province: address.bairro,
    complement: address.complemento,
  };
}
