import { z } from 'zod';

// ================================================================================
// Wizard Steps
// ================================================================================
// Step 0: Não iniciado
// Step 1: Tipo de conta (PF/PJ)
// Step 2: Identificação (escola + PF: nome/CPF/nascimento | PJ: razão social/CNPJ/tipo)
// Step 3: Contato (telefone, fixo opcional, e-mail financeiro opcional)
// Step 4: Endereço
// Step 5: Informações financeiras leves (faturamento)
// Step 6: Concluído
// ================================================================================

export type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type WizardPersonType = 'PF' | 'PJ';

export type WizardCompanyType = 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';

// ================================================================================
// Wizard State (snapshot do progresso)
// ================================================================================

export type WizardState = {
  step: WizardStep;
  completedAt: Date | null;
  schoolName: string | null;
  personType: WizardPersonType | null;
  cpfCnpj: string | null;
  birthDate: string | null; // YYYY-MM-DD
  ownerName: string | null;
  companyName: string | null;
  companyType: WizardCompanyType | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  incomeValue: number | null;
  address: string | null;
  addressNumber: string | null;
  province: string | null;
  addressCity: string | null;
  addressState: string | null;
  postalCode: string | null;
  complement: string | null;
  loginEmail: string | null;
};

export type GetWizardStateResult = {
  wizard: WizardState;
  canCreateSubaccount: boolean;
  missingFields: string[];
};

// ================================================================================
// Step 1: Tipo de Conta
// ================================================================================

export const wizardStep1Schema = z.object({
  personType: z.enum(['PF', 'PJ'], { required_error: 'Selecione o tipo de conta' }),
});

export type WizardStep1Data = z.infer<typeof wizardStep1Schema>;

// ================================================================================
// Helpers
// ================================================================================

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isAtLeastAgeYears(value: string, minAgeYears: number, now: Date = new Date()): boolean {
  if (!isValidDateOnly(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split('-');
  const birth = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
  const nowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let age = nowUtc.getUTCFullYear() - birth.getUTCFullYear();
  const nowMonth = nowUtc.getUTCMonth();
  const birthMonth = birth.getUTCMonth();
  if (
    nowMonth < birthMonth ||
    (nowMonth === birthMonth && nowUtc.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= minAgeYears;
}

const isValidCpfDigits = (val: string): boolean => {
  if (val.length !== 11) return false;
  if (val === '00000000000') return false;
  let sum = 0;
  for (let i = 1; i <= 9; i++) sum += parseInt(val.substring(i - 1, i)) * (11 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(val.substring(9, 10))) return false;
  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(val.substring(i - 1, i)) * (12 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(val.substring(10, 11))) return false;
  return true;
};

const isValidCnpjDigits = (val: string): boolean => {
  if (val.length !== 14) return false;
  let size = val.length - 2;
  let numbers = val.substring(0, size);
  const digits = val.substring(size);
  let sum = 0;
  let pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(digits.charAt(0))) return false;
  size = size + 1;
  numbers = val.substring(0, size);
  sum = 0;
  pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(digits.charAt(1))) return false;
  return true;
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizePhone = (value: string): string => value.replace(/\D/g, '');

// ================================================================================
// Step 2: Identificação
// ================================================================================

const baseIdentification = {
  personType: z.enum(['PF', 'PJ']),
  schoolName: z.string().trim().min(2, 'Informe o nome da escola'),
  cpfCnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length === 11 || v.length === 14, 'CPF/CNPJ incompleto'),
};

export const wizardStep2Schema = z
  .discriminatedUnion('personType', [
    z.object({
      ...baseIdentification,
      personType: z.literal('PF'),
      ownerName: z.string().trim().min(2, 'Informe um nome válido'),
      birthDate: z
        .string()
        .trim()
        .min(1, 'Informe a data de nascimento')
        .refine((v) => isValidDateOnly(v), 'Data inválida')
        .refine((v) => isAtLeastAgeYears(v, 18), 'Idade mínima de 18 anos'),
      companyName: z.string().trim().optional(),
      companyType: z.string().trim().optional(),
    }),
    z.object({
      ...baseIdentification,
      personType: z.literal('PJ'),
      companyName: z.string().trim().min(2, 'Informe a razão social'),
      companyType: z.enum(['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'], {
        required_error: 'Informe o tipo da empresa',
      }),
      ownerName: z.string().trim().optional(),
      birthDate: z.string().trim().optional(),
    }),
  ])
  .superRefine((data, ctx) => {
    const digits = data.cpfCnpj;

    if (data.personType === 'PF') {
      if (digits.length !== 11) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Informe um CPF válido',
          path: ['cpfCnpj'],
        });
      } else if (!isValidCpfDigits(digits)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CPF inválido', path: ['cpfCnpj'] });
      }
    }

    if (data.personType === 'PJ') {
      if (digits.length !== 14) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Informe um CNPJ válido',
          path: ['cpfCnpj'],
        });
      } else if (!isValidCnpjDigits(digits)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CNPJ inválido', path: ['cpfCnpj'] });
      }
    }
  });

export type WizardStep2Data = z.infer<typeof wizardStep2Schema>;

// ================================================================================
// Step 3: Contato
// ================================================================================

export const wizardStep3Schema = z.object({
  mobilePhone: z
    .string()
    .transform((v) => normalizePhone(v))
    .refine((v) => v.length >= 10 && v.length <= 13, 'Telefone inválido'),
  landlinePhone: z
    .string()
    .optional()
    .transform((v) => (v ? normalizePhone(v) : ''))
    .refine((v) => !v || (v.length >= 10 && v.length <= 13), 'Telefone inválido'),
  loginEmail: z
    .string()
    .optional()
    .transform((v) => (v ? v.trim() : ''))
    .refine((v) => !v || emailRegex.test(v), 'E-mail inválido'),
});

export type WizardStep3Data = z.infer<typeof wizardStep3Schema>;

// ================================================================================
// Step 4: Endereço
// ================================================================================

export const wizardStep4Schema = z.object({
  postalCode: z
    .string()
    .transform((v) => v.replace(/\D/g, '').slice(0, 8))
    .refine((v) => v.length === 8, 'CEP inválido'),
  address: z.string().trim().min(1, 'Informe o endereço'),
  addressNumber: z.string().trim().min(1, 'Informe o número'),
  province: z.string().trim().min(1, 'Informe o bairro'),
  addressCity: z.string().trim().min(1, 'Informe a cidade'),
  addressState: z.string().trim().min(2, 'Informe o estado').max(2, 'Informe o estado'),
  complement: z.string().trim().optional(),
});

export type WizardStep4Data = z.infer<typeof wizardStep4Schema>;

// ================================================================================
// Step 5: Informações Financeiras Leves
// ================================================================================

export const wizardStep5Schema = z.object({
  incomeValue: z.number().positive('Informe um valor maior que zero'),
});

export type WizardStep5Data = z.infer<typeof wizardStep5Schema>;

// ================================================================================
// Resultado de operações do wizard
// ================================================================================

export type SaveWizardStepResult = {
  success: boolean;
  wizard: WizardState;
  nextStep: WizardStep;
};

export type CompleteWizardResult = {
  success: boolean;
  wizard: WizardState;
  canCreateSubaccount: boolean;
  missingFields: string[];
  /** ID da subconta Asaas criada (se success=true) */
  asaasAccountId?: string;
  /** Erro detalhado (se success=false) */
  error?: {
    code: string;
    message: string;
  };
};

// ================================================================================
// Campos obrigatórios para criar subconta Asaas
// ================================================================================

export const REQUIRED_FIELDS_FOR_SUBACCOUNT = {
  common: [
    'schoolName',
    'ownerName',
    'cpfCnpj',
    'mobilePhone',
    'incomeValue',
    'address',
    'addressNumber',
    'province',
    'postalCode',
  ] as const,
  pf: ['birthDate'] as const,
  pj: ['companyName', 'companyType'] as const,
} as const;

export function getMissingFieldsForSubaccount(state: WizardState): string[] {
  if (!state.personType) return ['personType'];

  const missing: string[] = [];

  for (const field of REQUIRED_FIELDS_FOR_SUBACCOUNT.common) {
    const value = state[field];
    if (value === null || value === undefined || value === '') {
      missing.push(field);
    }
  }

  if (state.personType === 'PF') {
    for (const field of REQUIRED_FIELDS_FOR_SUBACCOUNT.pf) {
      const value = state[field];
      if (value === null || value === undefined || value === '') {
        missing.push(field);
      }
    }
  }

  if (state.personType === 'PJ') {
    for (const field of REQUIRED_FIELDS_FOR_SUBACCOUNT.pj) {
      const value = state[field];
      if (value === null || value === undefined || value === '') {
        missing.push(field);
      }
    }
  }

  return missing;
}

// ================================================================================
// Elegibilidade para Provisionamento Asaas
// ================================================================================

export type EligibilityReason =
  | 'MISSING_PERSON_TYPE'
  | 'MISSING_REQUIRED_FIELDS'
  | 'INVALID_CPF'
  | 'INVALID_CNPJ'
  | 'INVALID_BIRTH_DATE'
  | 'UNDERAGE'
  | 'MISSING_COMPANY_TYPE';

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: EligibilityReason; details: string[] };

/**
 * Verifica se o perfil está elegível para criação de subconta Asaas.
 *
 * Esta função é a fonte única de verdade para elegibilidade.
 * Não depende de wizardStep — apenas de dados concretos.
 */
export function isEligibleForAsaasProvisioning(state: WizardState): EligibilityResult {
  // 1. Tipo de pessoa é obrigatório
  if (!state.personType) {
    return { eligible: false, reason: 'MISSING_PERSON_TYPE', details: ['personType'] };
  }

  // 2. Validar campos obrigatórios
  const missingFields = getMissingFieldsForSubaccount(state);
  if (missingFields.length > 0) {
    return { eligible: false, reason: 'MISSING_REQUIRED_FIELDS', details: missingFields };
  }

  // 3. Validações específicas por tipo
  if (state.personType === 'PF') {
    // Validar formato de birthDate
    if (!state.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(state.birthDate)) {
      return { eligible: false, reason: 'INVALID_BIRTH_DATE', details: ['birthDate'] };
    }

    // Validar idade mínima (18 anos)
    const [yearStr, monthStr, dayStr] = state.birthDate.split('-');
    const birth = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
    const now = new Date();
    const nowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let age = nowUtc.getUTCFullYear() - birth.getUTCFullYear();
    const nowMonth = nowUtc.getUTCMonth();
    const birthMonth = birth.getUTCMonth();
    if (
      nowMonth < birthMonth ||
      (nowMonth === birthMonth && nowUtc.getUTCDate() < birth.getUTCDate())
    ) {
      age -= 1;
    }
    if (age < 18) {
      return { eligible: false, reason: 'UNDERAGE', details: ['birthDate'] };
    }

    // Validar CPF (11 dígitos)
    const cpfDigits = (state.cpfCnpj ?? '').replace(/\D/g, '');
    if (cpfDigits.length !== 11) {
      return { eligible: false, reason: 'INVALID_CPF', details: ['cpfCnpj'] };
    }
  }

  if (state.personType === 'PJ') {
    // Validar CNPJ (14 dígitos)
    const cnpjDigits = (state.cpfCnpj ?? '').replace(/\D/g, '');
    if (cnpjDigits.length !== 14) {
      return { eligible: false, reason: 'INVALID_CNPJ', details: ['cpfCnpj'] };
    }

    // Validar companyType
    const validCompanyTypes = ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'];
    if (!state.companyType || !validCompanyTypes.includes(state.companyType)) {
      return { eligible: false, reason: 'MISSING_COMPANY_TYPE', details: ['companyType'] };
    }
  }

  return { eligible: true };
}
