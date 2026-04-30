import { prisma } from '@alusa/database';
import type { AuditActorType, FinancialOnboardingStatus } from '@prisma/client';

import { financeProfileService, type FinanceProfileOnboardingData } from '../../foundation/finance-profile.service';
import { createAsaasAccount } from './create-asaas-account';
import { updateAsaasAccount } from './update-asaas-account';

export type CreateOrUpdateAsaasAccountResult = {
  financeProfileId: string;
  asaasAccountId: string | null;
  status: FinancialOnboardingStatus;
  action: 'CREATED' | 'UPDATED' | 'SKIPPED';
};

export async function createOrUpdateAsaasAccount(params: {
  contaId: string;
  data: Partial<FinanceProfileOnboardingData>;
  actor?: { type: AuditActorType; id?: string };
}): Promise<CreateOrUpdateAsaasAccountResult> {
  const financeProfile = await financeProfileService.getOrCreateByTenant(params.contaId);
  const existing = await prisma.asaasAccount.findUnique({ where: { financeProfileId: financeProfile.id } });

  if (!existing?.asaasAccountId) {
    const created = await createAsaasAccount({ contaId: params.contaId, actor: params.actor });
    return {
      financeProfileId: created.financeProfileId,
      asaasAccountId: created.asaasAccountId,
      status: created.status,
      action: created.created ? 'CREATED' : 'SKIPPED',
    };
  }

  await updateAsaasAccount({ contaId: params.contaId, data: params.data, actor: params.actor });

  const refreshed = await prisma.asaasAccount.findUnique({
    where: { financeProfileId: financeProfile.id },
    select: { asaasAccountId: true, status: true },
  });

  return {
    financeProfileId: financeProfile.id,
    asaasAccountId: refreshed?.asaasAccountId ?? existing.asaasAccountId,
    status: refreshed?.status ?? existing.status,
    action: 'UPDATED',
  };
}
