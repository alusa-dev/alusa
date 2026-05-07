import { describe, it, expect, vi, beforeEach } from 'vitest';

import { requestWithdraw } from '../request-withdraw';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      asaasAccount: {
        findUnique: vi.fn(),
      },
      transferRequest: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  AsaasHttpError: class AsaasHttpError extends Error {
    status: number;
    response: unknown;
    responseBody: unknown;

    constructor(message: string, status: number, response?: unknown, responseBody?: unknown) {
      super(message);
      this.name = 'AsaasHttpError';
      this.status = status;
      this.response = response;
      this.responseBody = responseBody;
    }
  },
  createPixTransfer: vi.fn(),
  createBankTransfer: vi.fn(),
  getTransfer: vi.fn(),
}));

vi.mock('../../foundation/feature-flags.service', () => ({
  featureFlagsService: {
    ensureTransferFeaturesForApprovedAccount: vi.fn(),
    isEnabled: vi.fn(),
  },
}));

vi.mock('../../foundation/finance-profile.service', () => ({
  financeProfileService: {
    getOrCreateByTenant: vi.fn(),
  },
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(async () => {}),
  },
}));

vi.mock('../get-balance', () => ({
  getBalance: vi.fn(),
}));

vi.mock('../../webhooks/ensure-webhook-config-operational', () => ({
  ensureWebhookConfigOperational: vi.fn(async () => {}),
}));

describe('requestWithdraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve bloquear quando enableManualWithdraw está off', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(false);

    const res = await requestWithdraw({
      contaId: 't1',
      value: 10,
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      idempotencyKey: 'k1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('FEATURE_DISABLED');
  });

  it('deve bloquear quando KYC não está aprovado', async () => {
    const { prisma } = await import('@alusa/database');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'IN_PROGRESS' } as never);

    const res = await requestWithdraw({
      contaId: 't1',
      value: 10,
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      idempotencyKey: 'k1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('KYC_NAO_APROVADO');
  });

  it('deve bloquear quando saldo é insuficiente', async () => {
    const { prisma } = await import('@alusa/database');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');
    const { getBalance } = await import('../get-balance');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'APPROVED' } as never);
    vi.mocked(getBalance).mockResolvedValueOnce({ success: true, data: { balance: 5 } } as never);

    const res = await requestWithdraw({
      contaId: 't1',
      value: 10,
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      idempotencyKey: 'k1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('SALDO_INSUFICIENTE');
  });

  it('deve ser idempotente quando já existe TransferRequest com asaasTransferId', async () => {
    const { prisma } = await import('@alusa/database');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');
    const { getBalance } = await import('../get-balance');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'APPROVED' } as never);
    vi.mocked(getBalance).mockResolvedValueOnce({ success: true, data: { balance: 100 } } as never);

    vi.mocked(prisma.transferRequest.findUnique).mockResolvedValueOnce({
      id: 'tr1',
      externalReference: 'transfer:tr1',
      asaasTransferId: 'asaas_tr_1',
      status: 'PENDING',
    } as never);

    const res = await requestWithdraw({
      contaId: 't1',
      value: 10,
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      idempotencyKey: 'k1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toMatchObject({
        transferRequestId: 'tr1',
        externalReference: 'transfer:tr1',
        asaasTransferId: 'asaas_tr_1',
        status: 'PENDING',
      });
    }
  });

  it('deve criar transferência PIX e persistir asaasTransferId', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createPixTransfer, getTransfer } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');
    const { getBalance } = await import('../get-balance');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'APPROVED' } as never);
    vi.mocked(getBalance).mockResolvedValueOnce({ success: true, data: { balance: 100 } } as never);

    vi.mocked(prisma.transferRequest.findUnique).mockResolvedValueOnce(null as never);

    vi.mocked(prisma.transferRequest.create).mockResolvedValueOnce({
      id: 'tr1',
      externalReference: 'transfer:pending:k1',
      asaasTransferId: null,
    } as never);

    // canonical externalReference update
    vi.mocked(prisma.transferRequest.update)
      .mockResolvedValueOnce({ id: 'tr1', externalReference: 'transfer:tr1', asaasTransferId: null } as never)
      // asaasTransferId/status update
      .mockResolvedValueOnce({} as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x', contaId: 't1' } as never);

    vi.mocked(createPixTransfer).mockResolvedValueOnce({ id: 'asaas_tr_1', status: 'PENDING' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      status: 'PENDING',
      authorized: true,
      failReason: null,
      transactionReceiptUrl: null,
      effectiveDate: null,
    } as never);

    const res = await requestWithdraw({
      contaId: 't1',
      value: 10,
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      idempotencyKey: 'k1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.asaasTransferId).toBe('asaas_tr_1');
      expect(res.data.externalReference).toBe('transfer:tr1');
    }

    expect(createPixTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sandbox_x',
        idempotencyKey: 'k1',
        data: expect.objectContaining({ externalReference: 'transfer:tr1', value: 10 }),
      }),
    );

    expect(getTransfer).toHaveBeenCalledWith({
      apiKey: 'sandbox_x',
      id: 'asaas_tr_1',
    });

    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr1' },
      data: expect.objectContaining({
        asaasTransferId: 'asaas_tr_1',
        rawAsaasStatus: 'PENDING',
        authorized: true,
      }),
    });
  });

  it('retorna PIX_KEY_NAO_ENCONTRADA quando o Asaas rejeita a chave Pix de destino', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { AsaasHttpError, createPixTransfer } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');
    const { getBalance } = await import('../get-balance');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'APPROVED' } as never);
    vi.mocked(getBalance).mockResolvedValueOnce({ success: true, data: { balance: 100 } } as never);
    vi.mocked(prisma.transferRequest.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.transferRequest.create).mockResolvedValueOnce({
      id: 'tr1',
      externalReference: 'transfer:pending:k1',
      asaasTransferId: null,
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({
      id: 'tr1',
      externalReference: 'transfer:tr1',
      asaasTransferId: null,
    } as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x', contaId: 't1' } as never);
    vi.mocked(createPixTransfer).mockRejectedValueOnce(
      new AsaasHttpError('A chave informada não foi encontrada.', 400, {
        errors: [{ description: 'A chave informada não foi encontrada.' }],
      }),
    );

    const res = await requestWithdraw({
      contaId: 't1',
      value: 10,
      destination: { type: 'PIX', pixAddressKey: 'chave-invalida', pixAddressKeyType: 'EMAIL' },
      idempotencyKey: 'k1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('PIX_KEY_NAO_ENCONTRADA');
  });
});
