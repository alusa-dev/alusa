import { prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { financeProfileService } from '../../foundation/finance-profile.service';
import {
  enqueueAsaasSubaccountProvisioning,
  processAsaasProvisioningJobs,
} from '../../jobs/provision-asaas-subaccounts';

import {
  type GetWizardStateResult,
  type SaveWizardStepResult,
  type CompleteWizardResult,
  type WizardState,
  type WizardStep,
  type WizardStep1Data,
  type WizardStep2Data,
  type WizardStep3Data,
  type WizardStep4Data,
  type WizardStep5Data,
  type WizardCompanyType,
  type WizardPersonType,
  getMissingFieldsForSubaccount,
  isEligibleForAsaasProvisioning,
  wizardStep1Schema,
  wizardStep2Schema,
  wizardStep3Schema,
  wizardStep4Schema,
  wizardStep5Schema,
} from './wizard-types';

const RECOVERY_REQUIRED_PREFIX = 'RECOVERY_REQUIRED:';

function isRetryableProvisioningErrorMessage(message: string | null | undefined): boolean {
  const normalized = message?.trim().toLowerCase() ?? '';
  if (!normalized) return false;

  return (
    normalized.includes('timeout') ||
    normalized.includes('network') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused') ||
    normalized.includes('enotfound') ||
    normalized.includes('temporar') ||
    normalized.includes('429') ||
    normalized.includes('500') ||
    normalized.includes('502') ||
    normalized.includes('503') ||
    normalized.includes('504')
  );
}

async function resolveImmediateProvisioningTerminalFailure(params: {
  financeProfileId: string;
  failedJobs: number;
  recoveryRequired: number;
}): Promise<{ code: string; message: string } | null> {
  if (params.failedJobs === 0 && params.recoveryRequired === 0) {
    return null;
  }

  const account = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: params.financeProfileId },
    select: {
      asaasAccountId: true,
      status: true,
      operationalStatus: true,
      provisionLastError: true,
    },
  });

  if (!account) {
    return null;
  }

  if (account.provisionLastError?.startsWith(RECOVERY_REQUIRED_PREFIX) || params.recoveryRequired > 0) {
    return {
      code: 'RECOVERY_REQUIRED',
      message:
        'A subconta existe no Asaas, mas a chave de API não está salva na Alusa. Reconecte a chave pelo painel administrativo.',
    };
  }

  if (account.status === 'PROVISIONING_FAILED' || account.operationalStatus === 'API_KEY_REQUIRED') {
    return {
      code: 'PROVISIONING_FAILED',
      message:
        account.provisionLastError ??
        'Não foi possível concluir o cadastro financeiro. Revise os dados e tente novamente.',
    };
  }

  if (!account.asaasAccountId && account.provisionLastError && !isRetryableProvisioningErrorMessage(account.provisionLastError)) {
    return {
      code: 'PROVISIONING_FAILED',
      message: account.provisionLastError,
    };
  }

  return null;
}

function toWizardStep(value: number | null | undefined): WizardStep {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6)
    return value;
  return 0;
}

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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadWizardState(contaId: string): Promise<WizardState> {
  const [profile, conta] = await Promise.all([
    prisma.financeProfile.findUnique({
      where: { contaId },
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
      },
    }),
    prisma.conta.findUnique({
      where: { id: contaId },
      select: {
        nome: true,
        cpfCnpj: true,
      },
    }),
  ]);

  if (!profile) {
    return {
      step: 0,
      completedAt: null,
      schoolName: conta?.nome ?? null,
      personType: null,
      cpfCnpj: conta?.cpfCnpj ?? null,
      birthDate: null,
      ownerName: null,
      companyName: null,
      companyType: null,
      mobilePhone: null,
      landlinePhone: null,
      incomeValue: null,
      address: null,
      addressNumber: null,
      province: null,
      addressCity: null,
      addressState: null,
      postalCode: null,
      complement: null,
      loginEmail: null,
    };
  }

  return {
    step: toWizardStep(profile.wizardStep),
    completedAt: profile.wizardCompletedAt,
    schoolName: conta?.nome ?? null,
    personType: toWizardPersonType(profile.draftPersonType),
    cpfCnpj: profile.draftCpfCnpj ?? conta?.cpfCnpj ?? null,
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

/**
 * Obtém o estado atual do wizard de onboarding.
 */
export async function getWizardState(contaId: string): Promise<GetWizardStateResult> {
  await financeProfileService.getOrCreateByTenant(contaId);

  const wizard = await loadWizardState(contaId);
  const missingFields = getMissingFieldsForSubaccount(wizard);
  const eligibility = isEligibleForAsaasProvisioning(wizard);
  const canCreateSubaccount = eligibility.eligible;

  return {
    wizard,
    canCreateSubaccount,
    missingFields,
  };
}

/**
 * Salva dados do Step 1 (tipo de conta).
 */
export async function saveWizardStep1(params: {
  contaId: string;
  data: WizardStep1Data;
  actor?: { type: AuditActorType; id?: string };
}): Promise<SaveWizardStepResult> {
  const validated = wizardStep1Schema.parse(params.data);
  const profile = await financeProfileService.getOrCreateByTenant(params.contaId);

  await prisma.financeProfile.update({
    where: { id: profile.id },
    data: {
      wizardStep: 1,
      draftPersonType: validated.personType,
    },
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.wizard.save_step_1',
    entity: { type: 'FinanceProfile', id: profile.id },
    metadata: { personType: validated.personType },
    actor: params.actor,
  });

  const wizard = await loadWizardState(params.contaId);

  return {
    success: true,
    wizard,
    nextStep: 2,
  };
}

/**
 * Salva dados do Step 2 (dados principais).
 */
export async function saveWizardStep2(params: {
  contaId: string;
  data: WizardStep2Data;
  actor?: { type: AuditActorType; id?: string };
}): Promise<SaveWizardStepResult> {
  const validated = wizardStep2Schema.parse(params.data);
  const profile = await financeProfileService.getOrCreateByTenant(params.contaId);

  const ownerName =
    validated.personType === 'PJ'
      ? (validated.companyName ?? validated.ownerName ?? '').trim()
      : (validated.ownerName ?? '').trim();
  const schoolName = validated.schoolName.trim();

  await prisma.$transaction([
    prisma.financeProfile.update({
      where: { id: profile.id },
      data: {
        wizardStep: 2,
        draftPersonType: validated.personType,
        draftCpfCnpj: validated.cpfCnpj,
        draftBirthDate: validated.personType === 'PF' ? (validated.birthDate ?? null) : null,
        asaasOwnerName: ownerName || null,
        asaasCompanyName: validated.personType === 'PJ' ? (validated.companyName ?? null) : null,
        companyType: validated.personType === 'PJ' ? (validated.companyType ?? null) : null,
      },
    }),
    prisma.conta.update({
      where: { id: params.contaId },
      data: {
        nome: schoolName,
        cpfCnpj: validated.cpfCnpj,
      },
    }),
  ]);

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.wizard.save_step_2',
    entity: { type: 'FinanceProfile', id: profile.id },
    metadata: { personType: validated.personType, schoolName },
    actor: params.actor,
  });

  const wizard = await loadWizardState(params.contaId);

  return {
    success: true,
    wizard,
    nextStep: 3,
  };
}

/**
 * Salva dados do Step 3 (contato).
 */
export async function saveWizardStep3(params: {
  contaId: string;
  data: WizardStep3Data;
  actor?: { type: AuditActorType; id?: string };
}): Promise<SaveWizardStepResult> {
  const validated = wizardStep3Schema.parse(params.data);
  const profile = await financeProfileService.getOrCreateByTenant(params.contaId);

  await prisma.financeProfile.update({
    where: { id: profile.id },
    data: {
      wizardStep: 3,
      mobilePhone: validated.mobilePhone,
      landlinePhone: validated.landlinePhone ? validated.landlinePhone : null,
    },
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.wizard.save_step_3',
    entity: { type: 'FinanceProfile', id: profile.id },
    actor: params.actor,
  });

  const wizard = await loadWizardState(params.contaId);

  return {
    success: true,
    wizard,
    nextStep: 4,
  };
}

/**
 * Salva dados do Step 4 (endereço).
 */
export async function saveWizardStep4(params: {
  contaId: string;
  data: WizardStep4Data;
  actor?: { type: AuditActorType; id?: string };
}): Promise<SaveWizardStepResult> {
  const validated = wizardStep4Schema.parse(params.data);
  const profile = await financeProfileService.getOrCreateByTenant(params.contaId);

  await prisma.financeProfile.update({
    where: { id: profile.id },
    data: {
      wizardStep: 4,
      address: validated.address,
      addressNumber: validated.addressNumber,
      province: validated.province,
      addressCity: validated.addressCity,
      addressState: validated.addressState.toUpperCase(),
      postalCode: validated.postalCode,
      complement: validated.complement ?? null,
    },
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.wizard.save_step_4',
    entity: { type: 'FinanceProfile', id: profile.id },
    actor: params.actor,
  });

  const wizard = await loadWizardState(params.contaId);

  return {
    success: true,
    wizard,
    nextStep: 5,
  };
}

/**
 * Salva dados do Step 5 (informações financeiras leves).
 */
export async function saveWizardStep5(params: {
  contaId: string;
  data: WizardStep5Data;
  actor?: { type: AuditActorType; id?: string };
}): Promise<SaveWizardStepResult> {
  const validated = wizardStep5Schema.parse(params.data);
  const profile = await financeProfileService.getOrCreateByTenant(params.contaId);

  await prisma.financeProfile.update({
    where: { id: profile.id },
    data: {
      wizardStep: 5,
      incomeValue: validated.incomeValue,
    },
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.wizard.save_step_5',
    entity: { type: 'FinanceProfile', id: profile.id },
    actor: params.actor,
  });

  const wizard = await loadWizardState(params.contaId);

  return {
    success: true,
    wizard,
    nextStep: 6,
  };
}

/**
 * Finaliza o wizard (step 6) e enfileira o provisionamento da subconta no Asaas.
 *
 * Fluxo corrigido:
 * 1. Valida elegibilidade pelos DADOS (não por wizardStep)
 * 2. Se elegível, enfileira provisionamento assíncrono
 * 3. Marca wizard como concluído sem depender da chamada remota ao Asaas
 *
 * Garantias:
 * - NÃO manipula wizardStep artificialmente antes da criação
 * - Usa isEligibleForAsaasProvisioning como fonte de verdade
 * - Idempotente: múltiplas chamadas reaproveitam o mesmo job de provisionamento
 */
export async function completeWizard(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
}): Promise<CompleteWizardResult> {
  const profile = await financeProfileService.getOrCreateByTenant(params.contaId);
  const conta = await prisma.conta.findUnique({
    where: { id: params.contaId },
    select: { financeIntegrationMode: true },
  });

  // 1. Carregar estado atual do wizard
  const wizard = await loadWizardState(params.contaId);

  if (conta?.financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT') {
    const now = new Date();

    await prisma.$transaction([
      prisma.financeProfile.update({
        where: { id: profile.id },
        data: {
          wizardStep: 6,
          wizardCompletedAt: now,
        },
      }),
      prisma.conta.update({
        where: { id: params.contaId },
        data: { financeStatus: 'FINANCE_PROFILE_COMPLETED' },
      }),
    ]);

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.wizard.complete_external_mode',
      entity: { type: 'FinanceProfile', id: profile.id },
      metadata: {
        completedAt: now.toISOString(),
        financeIntegrationMode: conta.financeIntegrationMode,
        skippedSubaccountProvisioning: true,
      },
      actor: params.actor,
    });

    const finalWizard = await loadWizardState(params.contaId);

    return {
      success: true,
      wizard: finalWizard,
      canCreateSubaccount: false,
      missingFields: [],
    };
  }

  // 2. Validar elegibilidade pelos DADOS (não por wizardStep)
  const eligibility = isEligibleForAsaasProvisioning(wizard);

  if (!eligibility.eligible) {
    const missingFields =
      eligibility.reason === 'MISSING_REQUIRED_FIELDS' ? eligibility.details : [];

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.wizard.complete_failed',
      entity: { type: 'FinanceProfile', id: profile.id },
      metadata: {
        reason: eligibility.reason,
        details: eligibility.details,
      },
      actor: params.actor,
    });

    return {
      success: false,
      wizard,
      canCreateSubaccount: false,
      missingFields,
      error: {
        code: eligibility.reason,
        message: getEligibilityMessage(eligibility),
      },
    };
  }

  const provisioning = await enqueueAsaasSubaccountProvisioning({
    contaId: params.contaId,
    actor: params.actor,
  });

  if (provisioning.status === 'RECOVERY_REQUIRED') {
    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.wizard.complete_failed',
      entity: { type: 'FinanceProfile', id: profile.id },
      metadata: {
        reason: 'subaccount_api_key_recovery_required',
        asaasAccountId: provisioning.asaasAccountId,
      },
      actor: params.actor,
    });

    const updatedWizard = await loadWizardState(params.contaId);

    return {
      success: false,
      wizard: updatedWizard,
      canCreateSubaccount: false,
      missingFields: [],
      error: {
        code: 'RECOVERY_REQUIRED',
        message:
          'A subconta existe no Asaas, mas a chave de API não está salva na Alusa. Reconecte a chave pelo painel administrativo.',
      },
    };
  }

  if (provisioning.status === 'QUEUED') {
    let immediateProcessingResult:
      | Awaited<ReturnType<typeof processAsaasProvisioningJobs>>
      | null = null;

    try {
      immediateProcessingResult = await processAsaasProvisioningJobs({ contaId: params.contaId, limit: 1 });
    } catch (error) {
      try {
        console.warn('[finance.completeWizard] Tentativa imediata de provisionamento falhou; cron processará', {
          contaId: params.contaId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // noop
      }
    }

    const terminalFailure = await resolveImmediateProvisioningTerminalFailure({
      financeProfileId: profile.id,
      failedJobs: immediateProcessingResult?.failed ?? 0,
      recoveryRequired: immediateProcessingResult?.recoveryRequired ?? 0,
    });

    if (terminalFailure) {
      const updatedWizard = await loadWizardState(params.contaId);

      await auditLogService.record({
        contaId: params.contaId,
        action: 'finance.wizard.complete_failed',
        entity: { type: 'FinanceProfile', id: profile.id },
        metadata: {
          reason: terminalFailure.code,
          provisioningFailedImmediately: true,
        },
        actor: params.actor,
      });

      return {
        success: false,
        wizard: updatedWizard,
        canCreateSubaccount: false,
        missingFields: [],
        error: terminalFailure,
      };
    }
  }

  // Sucesso local do wizard: só promove financeStatus a "perfil completo" quando subconta já existe e está conectada.
  let financeStatusAfterComplete: 'FINANCE_PROFILE_COMPLETED' | 'FINANCE_ONBOARDING_STARTED' =
    provisioning.status === 'CONNECTED' ? 'FINANCE_PROFILE_COMPLETED' : 'FINANCE_ONBOARDING_STARTED';

  if (financeStatusAfterComplete === 'FINANCE_ONBOARDING_STARTED') {
    const postAccount = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: profile.id },
      select: { asaasAccountId: true, apiKeyStatus: true },
    });
    if (postAccount?.asaasAccountId && postAccount.apiKeyStatus === 'CONNECTED') {
      financeStatusAfterComplete = 'FINANCE_PROFILE_COMPLETED';
    }
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.financeProfile.update({
      where: { id: profile.id },
      data: {
        wizardStep: 6,
        wizardCompletedAt: now,
      },
    }),
    prisma.conta.update({
      where: { id: params.contaId },
      data: { financeStatus: financeStatusAfterComplete },
    }),
  ]);

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.wizard.complete',
    entity: { type: 'FinanceProfile', id: profile.id },
    metadata: {
      completedAt: now.toISOString(),
      provisioningStatus: provisioning.status,
      provisioningQueued: provisioning.queued,
      asaasAccountId: provisioning.asaasAccountId,
    },
    actor: params.actor,
  });

  const finalWizard = await loadWizardState(params.contaId);

  return {
    success: true,
    wizard: finalWizard,
    canCreateSubaccount: true,
    missingFields: [],
    asaasAccountId: provisioning.asaasAccountId ?? undefined,
    provisioningStatus: provisioning.status,
  };
}

// ================================================================================
// Leitura de prontidão (sem mutar perfil — uso em diagnóstico suporte)
// ================================================================================

export type WizardReadinessSnapshot = {
  wizard: WizardState;
  missingFields: string[];
  canCreateSubaccount: boolean;
  eligibilityReason: ReturnType<typeof isEligibleForAsaasProvisioning>;
};

/**
 * Carrega estado do wizard e requisitos da subconta sem efeitos colaterais.
 */
export async function readWizardReadiness(contaId: string): Promise<WizardReadinessSnapshot | null> {
  const wizard = await loadWizardState(contaId);
  if (!wizard) return null;
  const missingFields = getMissingFieldsForSubaccount(wizard);
  const eligibilityReason = isEligibleForAsaasProvisioning(wizard);
  return {
    wizard,
    missingFields,
    canCreateSubaccount: eligibilityReason.eligible,
    eligibilityReason,
  };
}

// ================================================================================
// Helpers
// ================================================================================

function getEligibilityMessage(result: ReturnType<typeof isEligibleForAsaasProvisioning>): string {
  if (result.eligible) return '';

  switch (result.reason) {
    case 'MISSING_PERSON_TYPE':
      return 'Tipo de pessoa (PF/PJ) não informado.';
    case 'MISSING_REQUIRED_FIELDS':
      return `Campos obrigatórios não preenchidos: ${result.details.join(', ')}`;
    case 'INVALID_CPF':
      return 'CPF inválido.';
    case 'INVALID_CNPJ':
      return 'CNPJ inválido.';
    case 'INVALID_BIRTH_DATE':
      return 'Data de nascimento inválida.';
    case 'UNDERAGE':
      return 'Idade mínima de 18 anos não atingida.';
    case 'MISSING_COMPANY_TYPE':
      return 'Tipo de empresa não informado.';
    default:
      return 'Dados incompletos para criação da subconta.';
  }
}
