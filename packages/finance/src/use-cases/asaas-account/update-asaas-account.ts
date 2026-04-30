import { getMyAccountCommercialInfo, updateMyAccountCommercialInfo, type AsaasMyAccountCommercialInfo } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { AuditActorType, FinancialOnboardingStatus } from '@prisma/client';
import { detectPersonType } from '@alusa/shared';
import { z } from 'zod';

import { auditLogService } from '../../foundation/audit-log.service';
import { financeProfileService, type FinanceProfileOnboardingData } from '../../foundation/finance-profile.service';
import { MissingAsaasAccountIdError } from '../../errors/missing-asaas-account-id-error';
import { MissingAsaasApiKeyError } from '../../errors/missing-asaas-api-key-error';
import { resolveCommercialInfoState } from '../kyc/kyc-cache-utils';
import { resolveCanonicalSubaccountEmail } from './subaccount-email';

export type UpdateAsaasAccountResult = { status: FinancialOnboardingStatus };

type CompanyType = 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION';

const COMPANY_TYPES = ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'] as const;

function normalizeOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  const raw = String(value).trim();
  return raw ? raw : undefined;
}

function normalizeDigits(value: unknown): string | undefined {
  if (value == null) return undefined;
  const digits = String(value).replace(/\D/g, '');
  return digits ? digits : undefined;
}

function normalizePostalCode(value: unknown): string | undefined {
  const digits = normalizeDigits(value);
  if (!digits) return undefined;
  return digits.slice(0, 8);
}

function toDateOnlyUtcString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeIncomeValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value && typeof value === 'object' && 'toNumber' in value) {
    const num = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(num) ? num : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const num = Number(String(value).replace(',', '.'));
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
}

function normalizeCompanyType(value: unknown): CompanyType | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'MEI') return 'MEI';
  if (normalized === 'LIMITED') return 'LIMITED';
  if (normalized === 'INDIVIDUAL') return 'INDIVIDUAL';
  if (normalized === 'ASSOCIATION') return 'ASSOCIATION';
  return undefined;
}

function resolvePersonType(value: unknown, cpfCnpjDigits: string | undefined): 'FISICA' | 'JURIDICA' | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'PF' || normalized === 'FISICA') return 'FISICA';
    if (normalized === 'PJ' || normalized === 'JURIDICA') return 'JURIDICA';
  }

  if (!cpfCnpjDigits) return undefined;
  const detected = detectPersonType(cpfCnpjDigits);
  if (detected === 'PF') return 'FISICA';
  if (detected === 'PJ') return 'JURIDICA';
  return undefined;
}

const commercialInfoSchema = (availableCompanyNames: string[] = []) =>
  z.object({
    personType: z.enum(['FISICA', 'JURIDICA']),
    cpfCnpj: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v.length === 11 || v.length === 14, 'CPF/CNPJ inválido'),
    name: z.string().min(2, 'Nome inválido'),
    birthDate: z
      .string()
      .optional()
      .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Data inválida'),
    companyName: z.string().optional(),
    companyType: z.enum(COMPANY_TYPES).optional(),
    incomeValue: z.number().finite().positive('Informe um valor maior que zero'),
    email: z.string().email('E-mail inválido'),
    phone: z
      .string()
      .optional()
      .refine((v) => !v || (v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 13), 'Telefone inválido'),
    mobilePhone: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v.length >= 10 && v.length <= 13, 'Celular inválido'),
    postalCode: z
      .string()
      .transform((v) => v.replace(/\D/g, '').slice(0, 8))
      .refine((v) => v.length === 8, 'CEP inválido'),
    address: z.string().min(2, 'Endereço inválido'),
    addressNumber: z.string().min(1, 'Número inválido'),
    complement: z.string().optional(),
    province: z.string().min(2, 'Bairro inválido'),
    site: z.string().url('Site inválido').optional(),
  }).superRefine((data, ctx) => {
    if (data.personType === 'FISICA' && !data.birthDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Data de nascimento é obrigatória', path: ['birthDate'] });
    }

    if (data.personType === 'JURIDICA') {
      if (!data.companyType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tipo da empresa é obrigatório', path: ['companyType'] });
      }
      if (!data.companyName) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Razão social é obrigatória', path: ['companyName'] });
      }
      if (availableCompanyNames.length > 0 && data.companyName && !availableCompanyNames.includes(data.companyName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Selecione um dos nomes oficiais retornados pelo Asaas.',
          path: ['companyName'],
        });
      }
    }
  });

function coalesceString(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function resolveCommercialInfoPayload(params: {
  data: Partial<FinanceProfileOnboardingData>;
  existing?: AsaasMyAccountCommercialInfo | null;
  fallback: {
    ownerName?: string | null;
    companyName?: string | null;
    accountEmail?: string | null;
    cpfCnpj?: string | null;
    birthDate?: Date | null;
    loginEmail?: string | null;
    phone?: string | null;
    site?: string | null;
    mobilePhone?: string | null;
    incomeValue?: unknown;
    address?: string | null;
    addressNumber?: string | null;
    province?: string | null;
    postalCode?: string | null;
    complement?: string | null;
    companyType?: string | null;
    name?: string | null;
  };
}) {
  const cpfCnpjDigits = normalizeDigits(params.data.cpfCnpj ?? params.fallback.cpfCnpj ?? params.existing?.cpfCnpj);
  const personType = resolvePersonType(params.data.personType, cpfCnpjDigits);

  const ownerName = coalesceString(
    params.data.ownerName,
    params.data.name,
    params.fallback.ownerName,
    params.fallback.name,
    params.existing?.name,
  );

  const accountEmail = coalesceString(
    params.fallback.accountEmail,
    params.data.loginEmail,
    params.fallback.loginEmail,
    params.existing?.email,
  );
  const phone = normalizeDigits(coalesceString(params.data.phone, params.fallback.phone, params.existing?.phone));
  const site = coalesceString(params.data.site, params.fallback.site, params.existing?.site);

  const mobilePhone = normalizeDigits(
    coalesceString(params.data.mobilePhone, params.fallback.mobilePhone, params.existing?.mobilePhone),
  );

  const incomeValue =
    normalizeIncomeValue(params.data.incomeValue) ??
    normalizeIncomeValue(params.fallback.incomeValue) ??
    normalizeIncomeValue(params.existing?.incomeValue);

  const address = coalesceString(params.data.address, params.fallback.address, params.existing?.address);
  const addressNumber = coalesceString(params.data.addressNumber, params.fallback.addressNumber, params.existing?.addressNumber);
  const province = coalesceString(params.data.province, params.fallback.province, params.existing?.province);
  const postalCode = normalizePostalCode(params.data.postalCode ?? params.fallback.postalCode ?? params.existing?.postalCode);
  const complement = coalesceString(params.data.complement, params.fallback.complement, params.existing?.complement);

  const birthDate =
    params.data.birthDate ??
    (params.fallback.birthDate ? toDateOnlyUtcString(params.fallback.birthDate) : undefined) ??
    params.existing?.birthDate ??
    undefined;

  const companyType = normalizeCompanyType(params.data.companyType ?? params.fallback.companyType ?? params.existing?.companyType);
  const companyName = personType === 'JURIDICA'
    ? coalesceString(params.data.companyName, params.fallback.companyName, params.existing?.companyName)
    : undefined;

  const availableCompanyNames = Array.isArray(params.existing?.availableCompanyNames)
    ? params.existing?.availableCompanyNames.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      )
    : [];

  return commercialInfoSchema(availableCompanyNames).parse({
    personType,
    cpfCnpj: cpfCnpjDigits ?? '',
    name: ownerName ?? '',
    birthDate,
    companyName,
    companyType,
    incomeValue: incomeValue ?? NaN,
    email: accountEmail ?? '',
    phone,
    mobilePhone: mobilePhone ?? '',
    site,
    postalCode: postalCode ?? '',
    address: address ?? '',
    addressNumber: addressNumber ?? '',
    complement,
    province: province ?? '',
  });
}

export async function updateAsaasAccount(params: {
  contaId: string;
  data: Partial<FinanceProfileOnboardingData>;
  actor?: { type: AuditActorType; id?: string };
}): Promise<UpdateAsaasAccountResult> {
  const financeProfile = await financeProfileService.getOrCreateByTenant(params.contaId);
  const asaasAccount = await prisma.asaasAccount.findUnique({ where: { financeProfileId: financeProfile.id } });
  if (!asaasAccount) {
    return { status: 'NOT_STARTED' };
  }

  if (!asaasAccount.asaasAccountId) {
    throw new MissingAsaasAccountIdError();
  }

  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials?.apiKey) {
    throw new MissingAsaasApiKeyError('Credenciais Asaas não encontradas para o tenant');
  }

  const conta = await prisma.conta.findUnique({
    where: { id: params.contaId },
    select: { cpfCnpj: true, ownerUserId: true },
  });

  const [ownerUser, financeData] = await Promise.all([
    conta?.ownerUserId
      ? prisma.usuario.findUnique({ where: { id: conta.ownerUserId }, select: { email: true, birthDate: true } })
      : prisma.usuario.findFirst({
          where: { contaId: params.contaId },
          select: { email: true, birthDate: true },
          orderBy: { createdAt: 'asc' },
        }),
    prisma.financeProfile.findUnique({
      where: { id: financeProfile.id },
      select: {
        asaasOwnerName: true,
        asaasCompanyName: true,
        asaasName: true,
        asaasPhone: true,
        asaasSite: true,
        mobilePhone: true,
        incomeValue: true,
        address: true,
        addressNumber: true,
        province: true,
        postalCode: true,
        complement: true,
        companyType: true,
      },
    }),
  ]);

  const canonicalEmail = resolveCanonicalSubaccountEmail(ownerUser?.email ?? null);

  let existingCommercialInfo: AsaasMyAccountCommercialInfo | null = null;
  try {
    existingCommercialInfo = await getMyAccountCommercialInfo({ apiKey: credentials.apiKey });
  } catch (error) {
    try {
      console.warn('[finance.updateAsaasAccount] Falha ao carregar dados comerciais atuais', {
        contaId: params.contaId,
        asaasAccountId: asaasAccount.asaasAccountId,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // noop
    }
  }

  const payload = resolveCommercialInfoPayload({
    data: params.data,
    existing: existingCommercialInfo,
    fallback: {
      ownerName: financeData?.asaasOwnerName ?? financeData?.asaasName ?? null,
      companyName: financeData?.asaasCompanyName ?? null,
      accountEmail: canonicalEmail ?? asaasAccount.asaasAccountEmail ?? null,
      cpfCnpj: conta?.cpfCnpj ?? null,
      birthDate: ownerUser?.birthDate ?? null,
      phone: financeData?.asaasPhone ?? null,
      site: financeData?.asaasSite ?? null,
      mobilePhone: financeData?.mobilePhone ?? null,
      incomeValue: financeData?.incomeValue ?? null,
      address: financeData?.address ?? null,
      addressNumber: financeData?.addressNumber ?? null,
      province: financeData?.province ?? null,
      postalCode: financeData?.postalCode ?? null,
      complement: financeData?.complement ?? null,
      companyType: financeData?.companyType ?? null,
      name: financeData?.asaasName ?? null,
    },
  });

  const updatedCommercialInfo = await updateMyAccountCommercialInfo({
    apiKey: credentials.apiKey,
    data: payload,
  });

  const commercialInfoState = resolveCommercialInfoState({
    myAccountStatus: {
      commercialInfoExpiration: updatedCommercialInfo?.commercialInfoExpiration ?? null,
    },
    persistedScheduledDate: asaasAccount.commercialInfoScheduledDate ?? null,
  });

  await prisma.asaasAccount.update({
    where: { id: asaasAccount.id },
    data: {
      commercialInfoStatus: commercialInfoState.commercialInfoStatus,
      commercialInfoScheduledDate: commercialInfoState.commercialInfoScheduledDate,
      asaasAccountEmail: updatedCommercialInfo?.email ?? payload.email ?? asaasAccount.asaasAccountEmail ?? null,
    },
    select: { id: true },
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.onboarding.update_commercial_info',
    entity: { type: 'AsaasAccount', id: asaasAccount.id },
    metadata: { updatedFields: Object.keys(params.data ?? {}), asaasAccountId: asaasAccount.asaasAccountId },
    actor: params.actor,
  });

  return { status: asaasAccount.status };
}
