import { prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { getOnboardingStatus } from './get-onboarding-status';

export async function startFinancialOnboarding(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
}) {
  const conta = await prisma.conta.findUnique({
    where: { id: params.contaId },
    select: { id: true, financeStatus: true },
  });
  if (!conta) {
    throw new Error('Conta não encontrada');
  }

  const profile = await prisma.$transaction(async (tx) => {
    await tx.financeProfile.createMany({
      data: [{ contaId: params.contaId }],
      skipDuplicates: true,
    });

    const ensuredProfile = await tx.financeProfile.findUnique({
      where: { contaId: params.contaId },
      select: { id: true },
    });
    if (!ensuredProfile) {
      throw new Error('FinanceProfile não encontrado');
    }

    // Não “rebaixa” status mais avançados; a tela de onboarding chama /start de forma best-effort.
    if (conta.financeStatus === 'FINANCE_NOT_STARTED') {
      await tx.conta.update({
        where: { id: params.contaId },
        data: { financeStatus: 'FINANCE_ONBOARDING_STARTED' },
        select: { id: true },
      });
    }

    await tx.asaasAccount.createMany({
      data: [
        {
          financeProfileId: ensuredProfile.id,
          status: 'IN_PROGRESS',
          statusUpdatedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });

    return ensuredProfile;
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.onboarding.started',
    entity: { type: 'FinanceProfile', id: profile.id },
    actor: params.actor,
  });

  return getOnboardingStatus(params.contaId);
}
