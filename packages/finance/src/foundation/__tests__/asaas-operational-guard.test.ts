import { beforeEach, describe, expect, it, vi } from 'vitest';

const { financeProfileFindUniqueMock, asaasAccountUpdateMock, repairWebhookConfigDriftMock } = vi.hoisted(() => ({
  financeProfileFindUniqueMock: vi.fn(),
  asaasAccountUpdateMock: vi.fn(),
  repairWebhookConfigDriftMock: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    financeProfile: {
      findUnique: financeProfileFindUniqueMock,
    },
    asaasAccount: {
      update: asaasAccountUpdateMock,
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../../webhooks/webhook-config-drift.service', () => ({
  repairWebhookConfigDrift: repairWebhookConfigDriftMock,
}));

import { assertAsaasTenantOperational, syncAsaasOperationalStatus } from '../asaas-operational-guard';

describe('syncAsaasOperationalStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asaasAccountUpdateMock.mockResolvedValue({ id: 'asaas_local_1' });
  });

  it('não promove webhook para ACTIVE apenas por existir hash local', async () => {
    financeProfileFindUniqueMock.mockResolvedValue({
      id: 'profile_1',
      asaasAccount: {
        id: 'asaas_local_1',
        asaasAccountId: 'acc_1',
        apiKeyEncrypted: 'encrypted_key',
        apiKeyStatus: 'CONNECTED',
        webhookAuthTokenHash: 'hash_1',
        webhookStatus: 'NOT_CONFIGURED',
        operationalStatus: 'OPERATIONAL',
        status: 'APPROVED',
      },
    });

    const health = await syncAsaasOperationalStatus('conta_1');

    expect(health).toMatchObject({
      webhookStatus: 'NOT_CONFIGURED',
      webhookActive: false,
      operationalStatus: 'WEBHOOK_REQUIRED',
    });
    expect(asaasAccountUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'asaas_local_1' },
        data: expect.objectContaining({
          operationalStatus: 'WEBHOOK_REQUIRED',
        }),
      }),
    );
    expect(asaasAccountUpdateMock.mock.calls[0][0].data).not.toHaveProperty('webhookStatus');
  });

  it('mantém a conta bloqueada quando o provedor registrou bloqueio regulatório', async () => {
    financeProfileFindUniqueMock.mockResolvedValue({
      id: 'profile_1',
      asaasAccount: {
        id: 'asaas_local_1',
        asaasAccountId: 'acc_1',
        apiKeyEncrypted: 'encrypted_key',
        apiKeyStatus: 'CONNECTED',
        webhookStatus: 'ACTIVE',
        operationalStatus: 'OPERATIONAL',
        status: 'APPROVED',
        regulatoryBlockedAt: new Date('2026-08-11T00:00:00.000Z'),
      },
    });

    const health = await syncAsaasOperationalStatus('conta_1');

    expect(health).toMatchObject({
      regulatoryBlocked: true,
      operationalStatus: 'BLOCKED',
    });
    expect(asaasAccountUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ operationalStatus: 'BLOCKED' }),
      }),
    );
  });

  it('prioriza bloqueio regulatório antes de tentar reparar credenciais ou webhook', async () => {
    financeProfileFindUniqueMock.mockResolvedValue({
      id: 'profile_1',
      asaasAccount: {
        id: 'asaas_local_1',
        asaasAccountId: null,
        apiKeyEncrypted: null,
        apiKeyStatus: 'MISSING',
        webhookStatus: 'NOT_CONFIGURED',
        operationalStatus: 'BLOCKED',
        status: 'PROVISIONING_FAILED',
        regulatoryBlockedAt: new Date(),
      },
    });

    await expect(assertAsaasTenantOperational('conta_1')).rejects.toMatchObject({
      code: 'REGULATORY_BLOCKED',
    });
    expect(repairWebhookConfigDriftMock).not.toHaveBeenCalled();
  });
});
