import { prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { financeProfileService, type FinanceProfileOnboardingData } from '../foundation/finance-profile.service';
import { financeProfileOnboardingDataSchema } from '../foundation/schemas';

import { createAsaasAccount } from './asaas-account/create-asaas-account';
import { updateAsaasAccount } from './asaas-account/update-asaas-account';
import { getOnboardingStatus, type OnboardingStatusResult } from './get-onboarding-status';

export type SubmitKycDataResult = OnboardingStatusResult;

export async function submitKycData(params: {
  contaId: string;
  payload: FinanceProfileOnboardingData;
  actor?: { type: AuditActorType; id?: string };
}): Promise<SubmitKycDataResult> {
  const validated = financeProfileOnboardingDataSchema.parse(params.payload);

  // Distribute data:
  // 1. CPF/CNPJ -> Conta (School)
  if (validated.cpfCnpj) {
    await prisma.conta.update({
      where: { id: params.contaId },
      data: { cpfCnpj: validated.cpfCnpj },
    });
  }

  // 2. BirthDate -> Usuario (Owner)
  // We need to find the owner of the account to update their birth date
  const conta = await prisma.conta.findUnique({
    where: { id: params.contaId },
    select: { ownerUserId: true },
  });

  if (conta?.ownerUserId && validated.birthDate) {
    const [year, month, day] = validated.birthDate.split('-').map(Number);
    const birthDate = new Date(Date.UTC(year, month - 1, day));

    await prisma.usuario.update({
      where: { id: conta.ownerUserId },
      data: { birthDate },
    });
  }

  // 3. Address/Contact/Commercial -> FinanceProfile
  await financeProfileService.setOnboardingData(params.contaId, validated);

  // Fluxo state-aware:
  // - se não existir asaasAccountId: cria, persiste e encerra (não chama PUT na mesma execução)
  // - se existir: atualiza
  const created = await createAsaasAccount({ contaId: params.contaId, actor: params.actor });
  if (created.idempotent && created.asaasAccountId) {
    // Conflito 409 só deve ocorrer quando não há estado recuperável.
    // Se a subconta já existe, retornamos o snapshot idempotente.
    return getOnboardingStatus(params.contaId);
  }
  if (!created.asaasAccountId || created.created) {
    await prisma.asaasAccount.updateMany({
      where: {
        financeProfileId: created.financeProfileId,
        status: { in: ['IN_PROGRESS', 'CREATED'] },
      },
      data: { status: 'UNDER_REVIEW', statusUpdatedAt: new Date() },
    });

    await prisma.conta.update({
      where: { id: params.contaId },
      data: { financeStatus: 'FINANCE_PROFILE_COMPLETED' },
      select: { id: true },
    });

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.onboarding.submit_required_data',
      entity: { type: 'FinanceProfile', id: created.financeProfileId },
      metadata: { fields: Object.keys(validated), action: created.created ? 'CREATED' : 'SKIPPED' },
      actor: params.actor,
    });

    return getOnboardingStatus(params.contaId);
  }

  await updateAsaasAccount({ contaId: params.contaId, data: validated, actor: params.actor });

  const profile = await prisma.financeProfile.findUnique({ where: { contaId: params.contaId }, select: { id: true } });
  if (!profile) {
    throw new Error('FinanceProfile não encontrado');
  }

  const asaasAccount = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: profile.id },
    select: { id: true, status: true },
  });

  if (asaasAccount && (asaasAccount.status === 'IN_PROGRESS' || asaasAccount.status === 'CREATED')) {
    await prisma.asaasAccount.update({
      where: { id: asaasAccount.id },
      data: { status: 'UNDER_REVIEW', statusUpdatedAt: new Date() },
      select: { id: true },
    });
  }

  await prisma.conta.update({
    where: { id: params.contaId },
    data: { financeStatus: 'FINANCE_PROFILE_COMPLETED' },
    select: { id: true },
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.onboarding.submit_required_data',
    entity: { type: 'FinanceProfile', id: profile.id },
    metadata: { fields: Object.keys(validated) },
    actor: params.actor,
  });

  return getOnboardingStatus(params.contaId);
}
