import { z } from 'zod';

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return false;
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isAtLeastAgeYears(value: string, minAgeYears: number, now: Date = new Date()): boolean {
  if (!isValidDateOnly(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split('-');
  const birth = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
  const nowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let age = nowUtc.getUTCFullYear() - birth.getUTCFullYear();
  const nowMonth = nowUtc.getUTCMonth();
  const birthMonth = birth.getUTCMonth();
  if (nowMonth < birthMonth || (nowMonth === birthMonth && nowUtc.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age >= minAgeYears;
}

const onlyDigits = (v: string) => v.replace(/\D/g, '');

function normalizeOptionalString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const raw = String(v).trim();
  return raw ? raw : undefined;
}

const isValidCpfCnpjDigits = (val: string) => {
  if (val.length === 11) {
    let sum;
    let rest;
    sum = 0;
    if (val === '00000000000') return false;
    for (let i = 1; i <= 9; i++) sum = sum + parseInt(val.substring(i - 1, i)) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== parseInt(val.substring(9, 10))) return false;
    sum = 0;
    for (let i = 1; i <= 10; i++) sum = sum + parseInt(val.substring(i - 1, i)) * (12 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== parseInt(val.substring(10, 11))) return false;
    return true;
  }
  if (val.length === 14) {
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
  }
  return false;
};

export const financeProfileOnboardingDataSchema = z.object({
  personType: z.preprocess(
    (v) => (v == null ? undefined : String(v).trim().toUpperCase()),
    z.enum(['PF', 'PJ'], { required_error: 'Informe o tipo de pessoa' }),
  ),
  ownerName: z.preprocess(
    (v) => (v == null ? undefined : String(v).trim()),
    z.string().min(2, 'Informe um nome válido').optional(),
  ),
  name: z.preprocess(
    (v) => (v == null ? undefined : String(v).trim()),
    z.string().min(2, 'Informe um nome válido').optional(),
  ),
  companyName: z.preprocess(
    (v) => (v == null ? undefined : String(v)),
    z.string().optional(),
  ),
  cpfCnpj: z
    .preprocess(
      (v) => {
        if (v == null) return undefined;
        const raw = String(v).trim();
        return raw ? raw : undefined;
      },
      z
        .string()
        .transform((v) => onlyDigits(v))
        .refine((v) => v.length === 11 || v.length === 14, 'CPF/CNPJ inválido')
        .refine((v) => isValidCpfCnpjDigits(v), 'CPF/CNPJ inválido')
        .optional(),
    )
    .optional(),
  birthDate: z.preprocess(
    (v) => {
      if (v == null) return undefined;
      const raw = String(v).trim();
      return raw ? raw : undefined;
    },
    z
      .string()
      .min(10) // YYYY-MM-DD
      .refine((v) => isValidDateOnly(v), 'Data inválida')
      .refine((v) => isAtLeastAgeYears(v, 18), 'Deve ser maior de 18 anos')
      .optional(),
  ),
  companyType: z.preprocess(
    (v) => (v == null ? undefined : String(v).trim()),
    z.enum(['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION']).optional(),
  ),
  loginEmail: z.preprocess(normalizeOptionalString, z.string().email('E-mail inválido').optional()).optional(),
  phone: z
    .preprocess(normalizeOptionalString, z.string().optional())
    .transform((v) => (v ? onlyDigits(v) : undefined))
    .refine((v) => (v ? v.length >= 10 && v.length <= 13 : true), 'Telefone inválido')
    .optional(),
  site: z.preprocess(normalizeOptionalString, z.string().url('Site inválido').optional()).optional(),
  mobilePhone: z.preprocess(
    (v) => (v == null ? '' : String(v)),
    z
      .string()
      .transform((v) => onlyDigits(v))
      .refine((v) => v.length >= 10 && v.length <= 13, 'Telefone inválido'),
  ),
  incomeValue: z.preprocess(
    (v) => (v == null ? v : typeof v === 'number' ? v : Number(String(v).replace(',', '.'))),
    z.number().finite().positive('Informe um valor maior que zero'),
  ),
  address: z.preprocess((v) => (v == null ? '' : String(v).trim()), z.string().min(2, 'Endereço inválido')),
  addressNumber: z.preprocess(
    (v) => (v == null ? '' : String(v).trim()),
    z.string().min(1, 'Número inválido'),
  ),
  // No Asaas, `province` = bairro
  province: z.preprocess((v) => (v == null ? '' : String(v).trim()), z.string().min(2, 'Bairro inválido')),
  postalCode: z.preprocess(
    (v) => (v == null ? '' : String(v)),
    z
      .string()
      .transform((v) => onlyDigits(v).slice(0, 8))
      .refine((v) => v.length === 8, 'CEP inválido'),
  ),
  complement: z
    .preprocess((v) => (v == null ? undefined : String(v).trim()), z.string().optional())
    .optional(),
}).superRefine((data, ctx) => {
  const ownerName = data.ownerName?.trim() || data.name?.trim();
  if (!ownerName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nome do responsável é obrigatório', path: ['ownerName'] });
  }

  if (!data.cpfCnpj) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CPF/CNPJ é obrigatório', path: ['cpfCnpj'] });
    return;
  }

  const digits = onlyDigits(data.cpfCnpj);
  const isPf = data.personType === 'PF';
  const isPj = data.personType === 'PJ';

  if (isPf && digits.length !== 11) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um CPF válido', path: ['cpfCnpj'] });
  }

  if (isPj && digits.length !== 14) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe um CNPJ válido', path: ['cpfCnpj'] });
  }

  if (isPf && !data.birthDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Data de nascimento é obrigatória para Pessoa Física',
      path: ['birthDate'],
    });
  }

  if (isPj && !data.companyType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tipo da empresa é obrigatório para Pessoa Jurídica',
      path: ['companyType'],
    });
  }

  if (isPj && !data.companyName?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Razão social é obrigatória para Pessoa Jurídica',
      path: ['companyName'],
    });
  }
}).transform((data) => ({
  ...data,
  ownerName: data.ownerName?.trim() || data.name?.trim() || '',
}));

export type FinanceOnboardingInputDTO = z.infer<typeof financeProfileOnboardingDataSchema>;

export const financeOnboardingInputDto = financeProfileOnboardingDataSchema;

export const provisionAsaasSubaccountDto = z.object({
  contaId: z.string().min(1),
  financeProfileId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  actor: z
    .object({
      type: z.enum(['USER', 'ADMIN', 'SYSTEM']),
      id: z.string().optional(),
    })
    .optional(),
});

export const createWebhookPayloadDto = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  email: z.string().email(),
  enabled: z.boolean().default(true),
  interrupted: z.boolean().optional(),
  apiVersion: z.number().int().optional(),
  authToken: z.string().min(8),
  sendType: z.enum(['SEQUENTIALLY', 'NON_SEQUENTIALLY']).optional(),
  events: z.array(z.string().min(1)).min(1),
});

const createAsaasSubaccountPayloadBase = z.object({
  name: z.string().min(2),
  cpfCnpj: z.string().min(11),
  email: z.string().email(),
  birthDate: z
    .string()
    .min(1)
    .refine((v) => isValidDateOnly(v), 'Data inválida')
    .refine((v) => isAtLeastAgeYears(v, 18), 'É necessário ter 18 anos ou mais')
    .optional(),
  companyType: z.enum(['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION']).optional(),
  phone: z
    .string()
    .transform((v) => onlyDigits(v))
    .refine((v) => (v ? v.length >= 10 && v.length <= 13 : true), 'Telefone inválido')
    .optional(),
  mobilePhone: z.string().min(10),
  incomeValue: z.number().finite().positive(),
  address: z.string().min(2),
  addressNumber: z.string().min(1),
  complement: z.string().optional(),
  province: z.string().min(2),
  postalCode: z.string().min(8),
  externalReference: z.string().min(1).optional(),
  webhooks: z.array(createWebhookPayloadDto).min(1),
});

function validateAsaasAccountPayload(
  data: { cpfCnpj: string; birthDate?: string; companyType?: string },
  ctx: z.RefinementCtx,
) {
  const digits = onlyDigits(data.cpfCnpj);
  const isPf = digits.length === 11;
  if (isPf && !data.birthDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Data de nascimento é obrigatória para Pessoa Física',
      path: ['birthDate'],
    });
  }

  const isPj = digits.length === 14;
  if (isPj && !data.companyType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tipo da empresa é obrigatório para Pessoa Jurídica',
      path: ['companyType'],
    });
  }
}

export const createAsaasSubaccountPayloadDto =
  createAsaasSubaccountPayloadBase.superRefine(validateAsaasAccountPayload);

export const createAsaasAccountSchema = createAsaasSubaccountPayloadBase.omit({
  externalReference: true,
  webhooks: true,
}).superRefine(validateAsaasAccountPayload);

export type CreateAsaasAccountDTO = z.infer<typeof createAsaasAccountSchema>;

export const auditEntityRefSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1).optional(),
});

export const auditActorRefSchema = z.object({
  type: z.enum(['SYSTEM', 'USER', 'ADMIN']),
  id: z.string().min(1).optional(),
});

export const auditLogRecordSchema = z.object({
  contaId: z.string().min(1),
  action: z.string().min(1),
  entity: auditEntityRefSchema.optional(),
  metadata: z.unknown().optional(),
  actor: auditActorRefSchema.optional(),
});
