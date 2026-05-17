/**
 * Guard para garantir que a subconta Asaas exista antes de ações financeiras.
 *
 * Este guard implementa o padrão "Onboarding prepara. Ação financeira executa. Webhook confirma.":
 * 1. Durante o wizard, dados são coletados e persistidos localmente (sem chamadas Asaas)
 * 2. Na primeira ação financeira real (ex: criar cobrança), este guard é chamado
 * 3. Se a subconta não existe, o guard valida dados e cria no Asaas
 * 4. Webhooks do Asaas confirmam estados posteriores
 *
 * IMPORTANTE: Esta função NÃO depende de wizardStep.
 * A elegibilidade é determinada exclusivamente pelos dados preenchidos.
 */

import { AsaasHttpError } from '@alusa/asaas';
import { prisma } from '@alusa/database';
import type { AuditActorType, FinancialOnboardingStatus } from '@prisma/client';

import { AsaasSandboxSubaccountDailyLimitError } from '../../errors/asaas-sandbox-subaccount-daily-limit-error';
import { financeProfileService } from '../../foundation/finance-profile.service';
import { auditLogService } from '../../foundation/audit-log.service';
import {
  createAsaasAccount,
  type CreateAsaasAccountResult,
} from '../asaas-account/create-asaas-account';
import { MissingBirthDateError } from '../../errors/missing-birth-date-error';
import { MissingCompanyTypeError } from '../../errors/missing-company-type-error';
import {
  getMissingFieldsForSubaccount,
  isEligibleForAsaasProvisioning,
  type WizardPersonType,
  type WizardCompanyType,
  type WizardState,
  type EligibilityResult,
} from '../onboarding/wizard-types';

// ================================================================================
// Types
// ================================================================================

export type EnsureAsaasSubaccountSuccess = {
  ok: true;
  financeProfileId: string;
  asaasAccountId: string;
  status: FinancialOnboardingStatus;
  created: boolean;
};

export type EnsureAsaasSubaccountError =
  | 'NOT_ELIGIBLE'
  | 'MISSING_REQUIRED_FIELDS'
  | 'PROVISIONING_FAILED'
  | 'PROVISIONING_IN_PROGRESS'
  | 'ALREADY_REJECTED';

export type EnsureAsaasSubaccountFailure = {
  ok: false;
  code: EnsureAsaasSubaccountError;
  message: string;
  missingFields?: string[];
  eligibilityReason?: string;
};

export type EnsureAsaasSubaccountResult =
  | EnsureAsaasSubaccountSuccess
  | EnsureAsaasSubaccountFailure;

// ================================================================================
// Status que indicam subconta já provisionada ou em andamento
// ================================================================================

const ALREADY_PROVISIONED_STATUSES: FinancialOnboardingStatus[] = [
  'CREATED',
  'UNDER_REVIEW',
  'APPROVED',
];
const TERMINAL_FAILURE_STATUSES: FinancialOnboardingStatus[] = ['REJECTED'];
const IN_PROGRESS_STATUSES: FinancialOnboardingStatus[] = ['PROVISIONING'];

// ================================================================================
// Helpers
// ================================================================================

function toWizardPersonType(value: string | null | undefined): WizardPersonType | null {
  const normalized = (value ?? '').toUpperCase();
  if (normalized === 'PF' || normalized === 'FISICA') return 'PF';
  if (normalized === 'PJ' || normalized === 'JURIDICA') return 'PJ';
  return null;
}

function toWizardCompanyType(value: string | null | undefined): WizardCompanyType | null {
  const normalized = (value ?? '').toUpperCase();
  if (normalized === 'MEI') return 'MEI';
  if (normalized === 'LIMITED' || normalized === 'LTDA') return 'LIMITED';
  if (normalized === 'INDIVIDUAL' || normalized === 'EI') return 'INDIVIDUAL';
  if (normalized === 'ASSOCIATION') return 'ASSOCIATION';
  return null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && 'toNumber' in value) {
    const num = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

type AsaasErrorItem = { code?: string; description?: string };

function extractAsaasErrors(response: unknown): AsaasErrorItem[] {
  if (!response || typeof response !== 'object') return [];

  const errors = (response as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];

  return errors.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const code = (item as { code?: unknown }).code;
    const description = (item as { description?: unknown }).description;

    return [
      {
        ...(typeof code === 'string' ? { code } : {}),
        ...(typeof description === 'string' ? { description } : {}),
      },
    ];
  });
}

function isLikelyConfigurationError(item: AsaasErrorItem): boolean {
  const code = (item.code ?? '').toLowerCase();
  const description = (item.description ?? '').toLowerCase();

  if (code.includes('invalid_object') && description.includes('url')) return true;
  if (
    description.includes('url') &&
    (description.includes('inválida') || description.includes('invalida'))
  ) {
    return true;
  }

  return false;
}

function getProvisioningFailureMessage(error: unknown): string {
  if (error instanceof AsaasSandboxSubaccountDailyLimitError) {
    return 'O ambiente de testes atingiu o limite diário de cadastros financeiros. Tente novamente mais tarde.';
  }

  if (error instanceof MissingBirthDateError || error instanceof MissingCompanyTypeError) {
    return error.message;
  }

  if (error instanceof AsaasHttpError) {
    // Erro 403 com mensagem de whitelist de IPs: configuração na conta Asaas, não nos dados.
    if (error.status === 403) {
      const bodyStr = error.response
        ? (typeof error.response === 'string' ? error.response : JSON.stringify(error.response)).toLowerCase()
        : '';
      const msgStr = typeof error.message === 'string' ? error.message.toLowerCase() : '';
      if (msgStr.includes('whitelist') || bodyStr.includes('whitelist')) {
        return 'O servidor não está autorizado a chamar a API do Asaas. Configure os endereços IP autorizados em: Asaas > Integrações > Mecanismos de segurança.';
      }
    }

    const errors = extractAsaasErrors(error.response);

    for (const item of errors) {
      if (isLikelyConfigurationError(item)) {
        return 'Não foi possível concluir o cadastro financeiro por uma configuração pendente. Tente novamente em instantes.';
      }

      const code = (item.code ?? '').toLowerCase();
      const description = (item.description ?? '').toLowerCase();
      const looksLikeCpfCnpj =
        code.includes('cpf') ||
        code.includes('cnpj') ||
        description.includes('cpf') ||
        description.includes('cnpj');
      const looksInvalid =
        code.includes('invalid') ||
        description.includes('invál') ||
        description.includes('invalid');
      const looksDuplicate =
        description.includes('já cadastrad') ||
        description.includes('ja cadastrad') ||
        description.includes('já existe') ||
        description.includes('ja existe');

      if (looksLikeCpfCnpj && looksDuplicate) {
        return 'Este CPF/CNPJ já está vinculado a outro cadastro financeiro. Revise os dados antes de continuar.';
      }

      if (looksLikeCpfCnpj && looksInvalid) {
        return 'CPF/CNPJ inválido. Revise os dados antes de continuar.';
      }

      const looksLikeEmail =
        code.includes('email') || description.includes('e-mail') || description.includes('email');
      const looksInUse =
        description.includes('uso') ||
        description.includes('em uso') ||
        description.includes('cadastrad') ||
        code.includes('already');

      if (looksLikeEmail && looksInUse) {
        return 'O e-mail informado já está em uso em outro cadastro financeiro. Revise o e-mail da conta e tente novamente.';
      }
    }

    return 'Não foi possível concluir o cadastro financeiro. Revise os dados e tente novamente.';
  }

  if (
    error instanceof Error &&
    (error.message.includes('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET') ||
      error.message.includes('ASAAS_WEBHOOK_PUBLIC_BASE_URL') ||
      error.message.includes('NEXT_PUBLIC_APP_URL') ||
      error.message.includes('URL pública https'))
  ) {
    return 'Não foi possível concluir o cadastro financeiro por uma configuração pendente. Tente novamente em instantes.';
  }

  if (error instanceof Error && error.message.includes('CPF/CNPJ é obrigatório')) {
    return 'CPF/CNPJ é obrigatório para concluir o cadastro financeiro.';
  }

  return 'Não foi possível concluir o cadastro financeiro. Tente novamente.';
}

function buildWizardStateFromProfile(profile: {
  wizardStep: number;
  wizardCompletedAt: Date | null;
  draftPersonType: string | null;
  draftCpfCnpj: string | null;
  draftBirthDate: string | null;
  asaasOwnerName: string | null;
  asaasCompanyName: string | null;
  companyType: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  incomeValue: unknown;
  address: string | null;
  addressNumber: string | null;
  province: string | null;
  addressCity: string | null;
  addressState: string | null;
  postalCode: string | null;
  complement: string | null;
  asaasLoginEmail: string | null;
  conta?: { nome: string } | null;
}): WizardState {
  return {
    step: profile.wizardStep as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    completedAt: profile.wizardCompletedAt,
    schoolName: profile.conta?.nome ?? null,
    personType: toWizardPersonType(profile.draftPersonType),
    cpfCnpj: profile.draftCpfCnpj,
    birthDate: profile.draftBirthDate,
    ownerName: profile.asaasOwnerName,
    companyName: profile.asaasCompanyName,
    companyType: toWizardCompanyType(profile.companyType),
    mobilePhone: profile.mobilePhone,
    landlinePhone: profile.landlinePhone,
    incomeValue: toNumber(profile.incomeValue),
    address: profile.address,
    addressNumber: profile.addressNumber,
    province: profile.province,
    addressCity: profile.addressCity,
    addressState: profile.addressState,
    postalCode: profile.postalCode,
    complement: profile.complement,
    loginEmail: profile.asaasLoginEmail,
  };
}

// ================================================================================
// Guard Principal
// ================================================================================

/**
 * Garante que a subconta Asaas exista antes de executar ações financeiras.
 *
 * Fluxo baseado em ESTADO, não em wizardStep:
 * 1. Se subconta já existe (status CREATED/UNDER_REVIEW/APPROVED) → retorna sucesso (idempotente)
 * 2. Se status é REJECTED → retorna erro (terminal)
 * 3. Se status é PROVISIONING → retorna erro (em andamento)
 * 4. Valida elegibilidade pelos dados preenchidos (não por wizardStep)
 * 5. Marca status como PROVISIONING antes da chamada HTTP
 * 6. Cria subconta no Asaas
 * 7. Atualiza status baseado no resultado
 */
export async function ensureAsaasSubaccount(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
}): Promise<EnsureAsaasSubaccountResult> {
  const profile = await financeProfileService.getOrCreateByTenant(params.contaId);

  // 1. Verificar se subconta já existe (idempotência)
  const existingAccount = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: profile.id },
    select: {
      asaasAccountId: true,
      status: true,
      apiKeyEncrypted: true,
      apiKeyStatus: true,
      provisionLastError: true,
    },
  });

  if (
    existingAccount?.asaasAccountId &&
    ALREADY_PROVISIONED_STATUSES.includes(existingAccount.status) &&
    existingAccount.apiKeyEncrypted &&
    existingAccount.apiKeyStatus === 'CONNECTED'
  ) {
    return {
      ok: true,
      financeProfileId: profile.id,
      asaasAccountId: existingAccount.asaasAccountId,
      status: existingAccount.status,
      created: false,
    };
  }

  // 2. Verificar se está em status terminal (REJECTED)
  if (existingAccount && TERMINAL_FAILURE_STATUSES.includes(existingAccount.status)) {
    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.ensure_subaccount.already_rejected',
      entity: { type: 'AsaasAccount', id: existingAccount.asaasAccountId ?? profile.id },
      metadata: { status: existingAccount.status },
      actor: params.actor,
    });

    return {
      ok: false,
      code: 'ALREADY_REJECTED',
      message:
        'O cadastro financeiro foi rejeitado durante a análise. Revise os dados e fale com o suporte da Alusa se precisar de ajuda.',
    };
  }

  // 3. Verificar se já está em provisionamento
  if (existingAccount && IN_PROGRESS_STATUSES.includes(existingAccount.status)) {
    return {
      ok: false,
      code: 'PROVISIONING_IN_PROGRESS',
      message:
        'Criação da subconta já está em andamento. Aguarde alguns segundos e tente novamente.',
    };
  }

  // 4. Carregar dados do profile para validação de elegibilidade
  const profileData = await prisma.financeProfile.findUnique({
    where: { id: profile.id },
    select: {
      wizardStep: true,
      wizardCompletedAt: true,
      draftPersonType: true,
      draftCpfCnpj: true,
      draftBirthDate: true,
      asaasOwnerName: true,
      asaasCompanyName: true,
      companyType: true,
      mobilePhone: true,
      landlinePhone: true,
      incomeValue: true,
      address: true,
      addressNumber: true,
      province: true,
      addressCity: true,
      addressState: true,
      postalCode: true,
      complement: true,
      asaasLoginEmail: true,
      conta: {
        select: {
          nome: true,
        },
      },
    },
  });

  if (!profileData) {
    return {
      ok: false,
      code: 'NOT_ELIGIBLE',
      message: 'Perfil financeiro não encontrado.',
    };
  }

  const state = buildWizardStateFromProfile(profileData);

  // 5. Validar elegibilidade pelos DADOS, não por wizardStep
  const eligibility = isEligibleForAsaasProvisioning(state);

  if (!eligibility.eligible) {
    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.ensure_subaccount.not_eligible',
      entity: { type: 'FinanceProfile', id: profile.id },
      metadata: {
        reason: eligibility.reason,
        details: eligibility.details,
      },
      actor: params.actor,
    });

    const missingFields =
      eligibility.reason === 'MISSING_REQUIRED_FIELDS' ? eligibility.details : undefined;

    return {
      ok: false,
      code:
        eligibility.reason === 'MISSING_REQUIRED_FIELDS'
          ? 'MISSING_REQUIRED_FIELDS'
          : 'NOT_ELIGIBLE',
      message: getEligibilityErrorMessage(eligibility),
      missingFields,
      eligibilityReason: eligibility.reason,
    };
  }

  // 6. Marcar como PROVISIONING antes da chamada HTTP (evita chamadas duplicadas)
  if (existingAccount) {
    await prisma.asaasAccount.update({
      where: { financeProfileId: profile.id },
      data: {
        status: 'PROVISIONING',
        webhookStatus: 'PENDING',
        operationalStatus: 'PROVISIONING',
        provisionLastStage: 'ENSURE_ASAAS_SUBACCOUNT',
      },
      select: { id: true },
    });
  }

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.ensure_subaccount.provisioning_started',
    entity: { type: 'FinanceProfile', id: profile.id },
    actor: params.actor,
  });

  // 7. Criar subconta no Asaas
  let createResult: CreateAsaasAccountResult;

  try {
    createResult = await createAsaasAccount({
      contaId: params.contaId,
      actor: params.actor,
    });
  } catch (error) {
    // Marcar como PROVISIONING_FAILED
    await prisma.asaasAccount.updateMany({
      where: { financeProfileId: profile.id },
      data: { status: 'PROVISIONING_FAILED', operationalStatus: 'NOT_READY' },
    });

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.ensure_subaccount.provisioning_failed',
      entity: { type: 'FinanceProfile', id: profile.id },
      metadata: { error: error instanceof Error ? error.message : String(error) },
      actor: params.actor,
    });

    return {
      ok: false,
      code: 'PROVISIONING_FAILED',
      message: getProvisioningFailureMessage(error),
    };
  }

  // 8. Verificar resultado
  if (!createResult.asaasAccountId) {
    await prisma.asaasAccount.updateMany({
      where: { financeProfileId: profile.id },
      data: { status: 'PROVISIONING_FAILED', operationalStatus: 'NOT_READY' },
    });

    return {
      ok: false,
      code: 'PROVISIONING_FAILED',
      message: 'Subconta não foi criada. Verifique os dados e tente novamente.',
    };
  }

  if (createResult.requiresManualApiKeyRecovery) {
    return {
      ok: false,
      code: 'PROVISIONING_FAILED',
      message:
        'A subconta foi encontrada no Asaas, mas a chave de API não está salva na Alusa. Gere uma nova chave da subconta e reconecte pelo painel administrativo.',
    };
  }

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.ensure_subaccount.success',
    entity: { type: 'AsaasAccount', id: createResult.asaasAccountId },
    metadata: { created: createResult.created },
    actor: params.actor,
  });

  return {
    ok: true,
    financeProfileId: createResult.financeProfileId,
    asaasAccountId: createResult.asaasAccountId,
    status: createResult.status,
    created: createResult.created ?? true,
  };
}

// ================================================================================
// Helpers de mensagem
// ================================================================================

function getEligibilityErrorMessage(result: EligibilityResult): string {
  if (result.eligible) return '';

  switch (result.reason) {
    case 'MISSING_PERSON_TYPE':
      return 'Tipo de pessoa (PF/PJ) não informado.';
    case 'MISSING_REQUIRED_FIELDS':
      return `Campos obrigatórios ausentes: ${result.details.join(', ')}`;
    case 'INVALID_CPF':
      return 'CPF inválido. Deve conter 11 dígitos.';
    case 'INVALID_CNPJ':
      return 'CNPJ inválido. Deve conter 14 dígitos.';
    case 'INVALID_BIRTH_DATE':
      return 'Data de nascimento inválida.';
    case 'UNDERAGE':
      return 'Idade mínima de 18 anos não atingida.';
    case 'MISSING_COMPANY_TYPE':
      return 'Tipo de empresa não informado ou inválido.';
    default:
      return 'Perfil não elegível para concluir o cadastro financeiro.';
  }
}

// ================================================================================
// Verificação rápida (sem criar subconta)
// ================================================================================

export type CanCreateSubaccountResult = {
  canCreate: boolean;
  hasExistingSubaccount: boolean;
  isEligible: boolean;
  eligibilityResult: EligibilityResult;
  currentStatus: FinancialOnboardingStatus | null;
  missingFields: string[];
};

/**
 * Verifica se é possível criar a subconta (sem criar de fato).
 * Útil para UI mostrar estado antes de ação financeira.
 *
 * Não depende de wizardStep — usa elegibilidade baseada em dados.
 */
export async function canCreateSubaccount(contaId: string): Promise<CanCreateSubaccountResult> {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: {
      id: true,
      wizardStep: true,
      wizardCompletedAt: true,
      draftPersonType: true,
      draftCpfCnpj: true,
      draftBirthDate: true,
      asaasOwnerName: true,
      asaasCompanyName: true,
      companyType: true,
      mobilePhone: true,
      landlinePhone: true,
      incomeValue: true,
      address: true,
      addressNumber: true,
      province: true,
      addressCity: true,
      addressState: true,
      postalCode: true,
      complement: true,
      asaasLoginEmail: true,
      conta: {
        select: {
          nome: true,
        },
      },
    },
  });

  if (!profile) {
    return {
      canCreate: false,
      hasExistingSubaccount: false,
      isEligible: false,
      eligibilityResult: {
        eligible: false,
        reason: 'MISSING_PERSON_TYPE',
        details: ['personType'],
      },
      currentStatus: null,
      missingFields: ['personType'],
    };
  }

  const existing = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: profile.id },
    select: { asaasAccountId: true, status: true, apiKeyEncrypted: true, apiKeyStatus: true },
  });

  if (
    existing?.asaasAccountId &&
    existing.apiKeyEncrypted &&
    existing.apiKeyStatus === 'CONNECTED' &&
    ALREADY_PROVISIONED_STATUSES.includes(existing.status)
  ) {
    return {
      canCreate: true,
      hasExistingSubaccount: true,
      isEligible: true,
      eligibilityResult: { eligible: true },
      currentStatus: existing.status,
      missingFields: [],
    };
  }

  const state = buildWizardStateFromProfile(profile);
  const eligibility = isEligibleForAsaasProvisioning(state);
  const missingFields = getMissingFieldsForSubaccount(state);

  const canCreate =
    eligibility.eligible &&
    !TERMINAL_FAILURE_STATUSES.includes(existing?.status ?? 'NOT_STARTED') &&
    !IN_PROGRESS_STATUSES.includes(existing?.status ?? 'NOT_STARTED');

  return {
    canCreate,
    hasExistingSubaccount: false,
    isEligible: eligibility.eligible,
    eligibilityResult: eligibility,
    currentStatus: existing?.status ?? null,
    missingFields,
  };
}
