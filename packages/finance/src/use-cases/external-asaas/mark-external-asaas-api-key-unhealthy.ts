import { prisma } from '@alusa/database';

const RECONNECT_ONBOARDING_STATUSES = ['READY', 'WEBHOOK_PENDING'] as const;

export async function markExternalAsaasApiKeyUnhealthy(contaId: string): Promise<void> {
  await prisma.conta.updateMany({
    where: {
      id: contaId,
      financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
      externalAsaasOnboardingStatus: { in: [...RECONNECT_ONBOARDING_STATUSES] },
    },
    data: {
      externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
    },
  });
}
