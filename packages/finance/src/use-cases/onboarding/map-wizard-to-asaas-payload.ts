/**
 * Mapeamento de WizardState para payload de criação de subconta Asaas
 *
 * Este módulo converte os dados coletados no wizard de onboarding financeiro
 * para o formato esperado pela API do Asaas (POST /v3/accounts).
 *
 * Regras de negócio:
 * - PF: cpfCnpj = CPF, birthDate obrigatório, companyType NÃO enviado
 * - PJ: cpfCnpj = CNPJ, companyType obrigatório, birthDate NÃO enviado
 */

import type { CreateSubaccountInput, AsaasCompanyType } from '@alusa/asaas';
import type { WizardState, WizardPersonType, WizardCompanyType } from './wizard-types';

// ================================================================================
// Tipos de resultado
// ================================================================================

export type MapWizardToAsaasPayloadSuccess = {
  ok: true;
  payload: CreateSubaccountInput;
};

export type MapWizardToAsaasPayloadError = {
  ok: false;
  code: 'MISSING_REQUIRED_FIELD' | 'INVALID_PERSON_TYPE' | 'INVALID_COMPANY_TYPE';
  message: string;
  field?: string;
};

export type MapWizardToAsaasPayloadResult =
  | MapWizardToAsaasPayloadSuccess
  | MapWizardToAsaasPayloadError;

// ================================================================================
// Helpers de normalização
// ================================================================================

function sanitizeCpfCnpj(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

function sanitizePhone(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

function sanitizePostalCode(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '').slice(0, 8);
}

function mapCompanyType(value: WizardCompanyType | null | undefined): AsaasCompanyType | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase();
  if (normalized === 'MEI') return 'MEI';
  if (normalized === 'LIMITED') return 'LIMITED';
  if (normalized === 'INDIVIDUAL') return 'INDIVIDUAL';
  if (normalized === 'ASSOCIATION') return 'ASSOCIATION';
  return undefined;
}

function isValidPersonType(value: WizardPersonType | null | undefined): value is WizardPersonType {
  return value === 'PF' || value === 'PJ';
}

// ================================================================================
// Função principal
// ================================================================================

/**
 * Converte WizardState para o payload de criação de subconta Asaas.
 *
 * @param wizard - Estado do wizard com dados coletados
 * @param email - E-mail do responsável (obrigatório no Asaas)
 * @returns Payload formatado ou erro com campos faltantes
 */
export function mapWizardToAsaasPayload(
  wizard: WizardState,
  email: string,
): MapWizardToAsaasPayloadResult {
  // Validar personType
  if (!isValidPersonType(wizard.personType)) {
    return {
      ok: false,
      code: 'INVALID_PERSON_TYPE',
      message: 'Tipo de pessoa (PF/PJ) não definido',
      field: 'personType',
    };
  }

  const personType = wizard.personType;
  const cpfCnpj = sanitizeCpfCnpj(wizard.cpfCnpj);
  const mobilePhone = sanitizePhone(wizard.mobilePhone);
  const postalCode = sanitizePostalCode(wizard.postalCode);

  // Validar campos obrigatórios comuns
  const requiredFields: Array<{ field: string; value: unknown; label: string }> = [
    { field: 'schoolName', value: wizard.schoolName, label: 'Nome da escola' },
    { field: 'ownerName', value: wizard.ownerName, label: 'Nome' },
    { field: 'cpfCnpj', value: cpfCnpj, label: 'CPF/CNPJ' },
    { field: 'mobilePhone', value: mobilePhone, label: 'Celular' },
    { field: 'incomeValue', value: wizard.incomeValue, label: 'Faturamento mensal' },
    { field: 'address', value: wizard.address, label: 'Endereço' },
    { field: 'addressNumber', value: wizard.addressNumber, label: 'Número' },
    { field: 'province', value: wizard.province, label: 'Bairro' },
    { field: 'postalCode', value: postalCode, label: 'CEP' },
  ];

  for (const { field, value, label } of requiredFields) {
    if (value === null || value === undefined || value === '' || value === 0) {
      return {
        ok: false,
        code: 'MISSING_REQUIRED_FIELD',
        message: `Campo obrigatório não preenchido: ${label}`,
        field,
      };
    }
  }

  // Validações específicas por tipo de pessoa
  if (personType === 'PF') {
    if (!wizard.birthDate) {
      return {
        ok: false,
        code: 'MISSING_REQUIRED_FIELD',
        message: 'Data de nascimento é obrigatória para Pessoa Física',
        field: 'birthDate',
      };
    }

    if (cpfCnpj.length !== 11) {
      return {
        ok: false,
        code: 'MISSING_REQUIRED_FIELD',
        message: 'CPF inválido',
        field: 'cpfCnpj',
      };
    }
  }

  if (personType === 'PJ') {
    if (!wizard.companyType) {
      return {
        ok: false,
        code: 'INVALID_COMPANY_TYPE',
        message: 'Tipo de empresa é obrigatório para Pessoa Jurídica',
        field: 'companyType',
      };
    }

    const companyType = mapCompanyType(wizard.companyType);
    if (!companyType) {
      return {
        ok: false,
        code: 'INVALID_COMPANY_TYPE',
        message: `Tipo de empresa inválido: ${wizard.companyType}`,
        field: 'companyType',
      };
    }

    if (cpfCnpj.length !== 14) {
      return {
        ok: false,
        code: 'MISSING_REQUIRED_FIELD',
        message: 'CNPJ inválido',
        field: 'cpfCnpj',
      };
    }
  }

  // Montar payload base
  const payload: CreateSubaccountInput = {
    name:
      personType === 'PJ' && wizard.companyName
        ? wizard.companyName.trim()
        : (wizard.ownerName ?? '').trim(),
    email: email.trim(),
    cpfCnpj,
    mobilePhone,
    incomeValue: wizard.incomeValue!,
    address: (wizard.address ?? '').trim(),
    addressNumber: (wizard.addressNumber ?? '').trim(),
    province: (wizard.province ?? '').trim(),
    postalCode,
  };

  // Adicionar campos opcionais
  if (wizard.complement?.trim()) {
    payload.complement = wizard.complement.trim();
  }

  const landlinePhone = sanitizePhone(wizard.landlinePhone);
  if (landlinePhone) {
    payload.phone = landlinePhone;
  }

  // Campos condicionais por tipo de pessoa
  if (personType === 'PF' && wizard.birthDate) {
    payload.birthDate = wizard.birthDate;
  }

  if (personType === 'PJ' && wizard.companyType) {
    payload.companyType = mapCompanyType(wizard.companyType);
  }

  return {
    ok: true,
    payload,
  };
}

/**
 * Valida se o WizardState tem todos os campos necessários para criar subconta.
 * Não monta o payload, apenas valida.
 */
export function validateWizardForAsaas(wizard: WizardState): {
  valid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  if (!isValidPersonType(wizard.personType)) {
    missingFields.push('personType');
  }

  const cpfCnpj = sanitizeCpfCnpj(wizard.cpfCnpj);
  const mobilePhone = sanitizePhone(wizard.mobilePhone);
  const postalCode = sanitizePostalCode(wizard.postalCode);

  if (!wizard.ownerName?.trim()) missingFields.push('ownerName');
  if (!wizard.schoolName?.trim()) missingFields.push('schoolName');
  if (!cpfCnpj) missingFields.push('cpfCnpj');
  if (!mobilePhone) missingFields.push('mobilePhone');
  if (wizard.incomeValue === null || wizard.incomeValue === undefined || wizard.incomeValue <= 0) {
    missingFields.push('incomeValue');
  }
  if (!wizard.address?.trim()) missingFields.push('address');
  if (!wizard.addressNumber?.trim()) missingFields.push('addressNumber');
  if (!wizard.province?.trim()) missingFields.push('province');
  if (!postalCode || postalCode.length !== 8) missingFields.push('postalCode');

  if (wizard.personType === 'PF') {
    if (!wizard.birthDate) missingFields.push('birthDate');
    if (cpfCnpj && cpfCnpj.length !== 11) missingFields.push('cpfCnpj');
  }

  if (wizard.personType === 'PJ') {
    if (!wizard.companyType) missingFields.push('companyType');
    if (cpfCnpj && cpfCnpj.length !== 14) missingFields.push('cpfCnpj');
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}
