import { describe, it, expect, vi, beforeEach } from 'vitest';

import { reconcileOpenTransfers } from '../reconcile-open-transfers';

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    transferRequest: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    pixTransferSession: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('@alusa/asaas', () => ({
  getTransfer: vi.fn(),
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

describe('reconcileOpenTransfers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna reconciled=0 sem credenciais', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null as never);

    const res = await reconcileOpenTransfers({ contaId: 'c1' });
    expect(res.reconciled).toBe(0);
  });

  it('retorna reconciled=0 quando não há transferências abertas', async () => {
    const { loadAsaasCredentials, prisma } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([] as never);

    const res = await reconcileOpenTransfers({ contaId: 'c1' });
    expect(res.reconciled).toBe(0);
  });

  it('atualiza status quando Asaas retorna status diferente', async () => {
    const { loadAsaasCredentials, prisma } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      { id: 'tr1', asaasTransferId: 'a1', externalReference: 'transfer:tr1', status: 'PENDING', authorized: false },
    ] as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'a1',
      status: 'DONE',
      authorized: true,
      failReason: null,
      transactionReceiptUrl: 'https://r.ec/1',
      effectiveDate: '2026-03-26',
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.pixTransferSession.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const res = await reconcileOpenTransfers({ contaId: 'c1' });
    expect(res.reconciled).toBe(1);
    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr1' },
      data: expect.objectContaining({
        status: 'DONE',
        rawAsaasStatus: 'DONE',
        authorized: true,
        transactionReceiptUrl: 'https://r.ec/1',
        effectiveDate: '2026-03-26',
      }),
    });
  });

  it('atualiza authorized sem mudar status (SMS token confirmado)', async () => {
    const { loadAsaasCredentials, prisma } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      { id: 'tr1', asaasTransferId: 'a1', externalReference: 'transfer:tr1', status: 'PENDING', authorized: false },
    ] as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'a1',
      // status ainda PENDING — só authorized mudou (usuário autorizou via SMS)
      status: 'PENDING',
      authorized: true,
      failReason: null,
      transactionReceiptUrl: null,
      effectiveDate: null,
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.pixTransferSession.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const res = await reconcileOpenTransfers({ contaId: 'c1' });
    expect(res.reconciled).toBe(1);

    // Deve ter atualizado authorized=true sem mudar status
    const updateCall = vi.mocked(prisma.transferRequest.update).mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(updateCall.data.authorized).toBe(true);
    // status não deve estar no data ou deve ser undefined (não houve mudança)
    expect(updateCall.data.status).toBeUndefined();
  });

  it('não atualiza quando status igual e authorized igual', async () => {
    const { loadAsaasCredentials, prisma } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      { id: 'tr1', asaasTransferId: 'a1', externalReference: 'transfer:tr1', status: 'PENDING', authorized: true },
    ] as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'a1',
      status: 'PENDING',
      authorized: true,
    } as never);

    const res = await reconcileOpenTransfers({ contaId: 'c1' });
    expect(res.reconciled).toBe(0);
    expect(prisma.transferRequest.update).not.toHaveBeenCalled();
  });

  it('bloqueia regressão de estado e registra warning', async () => {
    const { loadAsaasCredentials, prisma } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      { id: 'tr1', asaasTransferId: 'a1', externalReference: 'transfer:tr1', status: 'PROCESSING', authorized: true },
    ] as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'a1',
      status: 'PENDING', // regressão: PROCESSING → PENDING
      authorized: true,
    } as never);

    const res = await reconcileOpenTransfers({ contaId: 'c1' });
    expect(res.reconciled).toBe(0);
    expect(prisma.transferRequest.update).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[finance][reconcileOpenTransfers][state-regression-blocked]',
      expect.objectContaining({ currentStatus: 'PROCESSING', attemptedStatus: 'PENDING' }),
    );

    warnSpy.mockRestore();
  });
});
