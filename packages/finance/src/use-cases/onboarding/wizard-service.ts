import { prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { financeProfileService } from '../../foundation/finance-profile.service';
import { ensureAsaasSubaccount } from '../asaas-account/ensure-asaas-subaccount';

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
 * Finaliza o wizard (step 6) e cria a subconta no Asaas.
 *
 * Fluxo corrigido:
 * 1. Valida elegibilidade pelos DADOS (não por wizardStep)
 * 2. Se elegível, delega criação ao ensureAsaasSubaccount
 * 3. Marca wizard como concluído somente após sucesso
 *
 * Garantias:
 * - NÃO manipula wizardStep artificialmente antes da criação
 * - Usa isEligibleForAsaasProvisioning como fonte de verdade
 * - Idempotente: múltiplas chamadas não criam subcontas duplicadas
 */
export async function completeWizard(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
}): Promise<CompleteWizardResult> {
  const profile = await financeProfileService.getOrCreateByTenant(params.contaId);

  // 1. Carregar estado atual do wizard
  const wizard = await loadWizardState(params.contaId);

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

  // 3. Criar subconta no Asaas (idempotente)
  // ensureAsaasSubaccount agora não depende de wizardStep
  const subaccountResult = await ensureAsaasSubaccount({
    contaId: params.contaId,
    actor: params.actor,
  });

  if (!subaccountResult.ok) {
    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.wizard.complete_failed',
      entity: { type: 'FinanceProfile', id: profile.id },
      metadata: {
        reason: 'subaccount_creation_failed',
        code: subaccountResult.code,
        message: subaccountResult.message,
      },
      actor: params.actor,
    });

    const updatedWizard = await loadWizardState(params.contaId);

    return {
      success: false,
      wizard: updatedWizard,
      canCreateSubaccount: false,
      missingFields: subaccountResult.missingFields ?? [],
      error: {
        code: subaccountResult.code,
        message: subaccountResult.message,
      },
    };
  }

  // 4. Sucesso: marcar wizard como concluído
  const now = new Date();

  await prisma.financeProfile.update({
    where: { id: profile.id },
    data: {
      wizardStep: 6,
      wizardCompletedAt: now,
    },
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.wizard.complete',
    entity: { type: 'FinanceProfile', id: profile.id },
    metadata: {
      completedAt: now.toISOString(),
      asaasAccountId: subaccountResult.asaasAccountId,
      created: subaccountResult.created,
    },
    actor: params.actor,
  });

  const finalWizard = await loadWizardState(params.contaId);

  return {
    success: true,
    wizard: finalWizard,
    canCreateSubaccount: true,
    missingFields: [],
    asaasAccountId: subaccountResult.asaasAccountId,
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
