import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateManyMock = vi.fn();

vi.mock('@alusa/database', () => ({
  prisma: {
    conta: {
      updateMany: updateManyMock,
    },
  },
}));

describe('markExternalAsaasApiKeyUnhealthy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateManyMock.mockResolvedValue({ count: 1 });
  });

  it('marca onboarding externo como pendente quando a chave deixa de estar saudavel', async () => {
    const { markExternalAsaasApiKeyUnhealthy } = await import('../mark-external-asaas-api-key-unhealthy');

    await markExternalAsaasApiKeyUnhealthy('conta_1');

    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'conta_1',
        financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
        externalAsaasOnboardingStatus: { in: ['READY', 'WEBHOOK_PENDING'] },
      },
      data: {
        externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
      },
    });
  });
});
