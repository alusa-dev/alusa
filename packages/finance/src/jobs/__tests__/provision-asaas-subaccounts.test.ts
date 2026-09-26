import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findManyMock,
  claimJobMock,
  updateJobMock,
  upsertJobMock,
  updateAccountsMock,
  upsertAccountMock,
  financeProfileFindUniqueMock,
  transactionMock,
  createAccountMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  claimJobMock: vi.fn(),
  updateJobMock: vi.fn(),
  upsertJobMock: vi.fn(),
  updateAccountsMock: vi.fn(),
  upsertAccountMock: vi.fn(),
  financeProfileFindUniqueMock: vi.fn(),
  transactionMock: vi.fn(),
  createAccountMock: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasIntegrationJob: {
      findMany: findManyMock,
      updateMany: claimJobMock,
      update: updateJobMock,
      upsert: upsertJobMock,
    },
    asaasAccount: { updateMany: updateAccountsMock, upsert: upsertAccountMock },
    financeProfile: { findUnique: financeProfileFindUniqueMock },
    $transaction: transactionMock,
  },
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn() },
}));

vi.mock('../../use-cases/asaas-account/create-asaas-account', () => ({
  createAsaasAccount: createAccountMock,
}));

vi.mock('../../webhooks/webhook-config-drift.service', () => ({
  repairWebhookConfigDrift: vi.fn(),
}));

import { AsaasHttpError } from '@alusa/asaas';

import { processAsaasProvisioningJobs } from '../provision-asaas-subaccounts';

describe('processAsaasProvisioningJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([{
      id: 'job-1',
      contaId: 'conta-1',
      type: 'PROVISION_SUBACCOUNT',
      status: 'PENDING',
      attempts: 0,
      payload: { financeProfileId: 'profile-1' },
    }]);
    claimJobMock.mockResolvedValue({ count: 1 });
    updateJobMock.mockResolvedValue({ id: 'job-1' });
    updateAccountsMock.mockResolvedValue({ count: 1 });
    upsertAccountMock.mockResolvedValue({ id: 'account-1' });
    upsertJobMock.mockResolvedValue({ id: 'job-1' });
    createAccountMock.mockRejectedValue(new AsaasHttpError('HTTP 400', 400, {
      errors: [{ code: 'invalid_object', description: 'O email owner@example.com já está em uso.' }],
    }));
  });

  it('move conflito determinístico para ação necessária sem agendar retry automático', async () => {
    const result = await processAsaasProvisioningJobs({ contaId: 'conta-1' });

    expect(result).toMatchObject({ processed: 1, failed: 1 });
    expect(result.errors[0]?.error).toContain('já está em uso no Asaas');
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['PENDING', 'FAILED'] } }),
    }));
    expect(updateAccountsMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'PROVISIONING_FAILED',
        operationalStatus: 'NOT_READY',
        provisionLastHttpStatus: 400,
      }),
    }));
    expect(updateJobMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'ACTION_REQUIRED',
        attempts: 1,
        lastError: expect.stringContaining('ACTION_REQUIRED:ASAAS_EMAIL_IN_USE:'),
        processingAt: null,
      }),
    }));
    expect(updateJobMock.mock.calls[0]?.[0].data.nextAttemptAt).toBeInstanceOf(Date);
    expect(updateJobMock.mock.calls[0]?.[0].data.lastError).not.toContain('owner@example.com');
  });

  it('reenfileira o provisionamento depois de uma correção explícita', async () => {
    financeProfileFindUniqueMock.mockResolvedValue({
      id: 'profile-1',
      asaasAccount: {
        asaasAccountId: null,
        status: 'PROVISIONING_FAILED',
        apiKeyEncrypted: null,
        apiKeyStatus: 'MISSING',
        provisionLastError: 'ACTION_REQUIRED:ASAAS_EMAIL_IN_USE:email já usado',
      },
    });
    transactionMock.mockImplementation(async (callback: (_tx: unknown) => Promise<unknown>) =>
      callback({
        asaasAccount: { upsert: upsertAccountMock },
        asaasIntegrationJob: { upsert: upsertJobMock },
      }),
    );

    const result = await (await import('../provision-asaas-subaccounts')).enqueueAsaasSubaccountProvisioning({
      contaId: 'conta-1',
      actor: { type: 'USER', id: 'user-1' },
    });

    expect(result).toMatchObject({ queued: true, status: 'QUEUED', financeProfileId: 'profile-1' });
    expect(upsertAccountMock).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        status: 'READY_FOR_PROVISIONING',
        provisionLastError: null,
        provisionLastHttpStatus: null,
      }),
    }));
    expect(upsertJobMock).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        status: 'PENDING',
        lastError: null,
      }),
    }));
  });
});
