import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualSyncError, resendTaxaMatricula } from '../manual-sync';

vi.mock('@alusa/database', () => ({
  prisma: {
    cobranca: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../create-charge', () => ({
  createCharge: vi.fn(),
}));

vi.mock('../get-asaas-payment-details', () => ({
  getAsaasPaymentDetails: vi.fn(),
}));

vi.mock('../asaas-ops', () => ({
  formatDate: vi.fn((value: Date | string) =>
    typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10),
  ),
  getCurrentBrasiliaDate: vi.fn(() => ({
    dateObj: new Date('2026-04-01T12:00:00.000Z'),
    dateStr: '2026-04-01',
    year: 2026,
    month: 4,
    day: 1,
  })),
  listPayments: vi.fn(),
}));

vi.mock('../sync-payment-state-from-asaas', () => ({
  syncPaymentStateFromAsaas: vi.fn(),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(async () => {}),
  },
}));

describe('resendTaxaMatricula', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconcilia por externalReference quando o payment oficial já existe', async () => {
    const { prisma } = await import('@alusa/database');
    const { listPayments } = await import('../asaas-ops');
    const { syncPaymentStateFromAsaas } = await import('../sync-payment-state-from-asaas');
    const { getAsaasPaymentDetails } = await import('../get-asaas-payment-details');
    const { createCharge } = await import('../create-charge');

    vi.mocked(prisma.cobranca.findUnique)
      .mockResolvedValueOnce({
        id: 'cobranca-1',
        tipo: 'TAXA_MATRICULA',
        status: 'PENDENTE',
        vencimento: new Date('2026-03-31T03:00:00.000Z'),
        asaasPaymentId: null,
        matriculaId: 'matricula-1',
        matricula: {
          aluno: { contaId: 'conta-1' },
          taxaStatus: 'PENDENTE',
        },
      } as never)
      .mockResolvedValueOnce({
        status: 'A_VENCER',
        asaasPaymentId: 'pay_remote_1',
        matricula: { taxaStatus: 'PENDENTE' },
      } as never);

    vi.mocked(listPayments).mockResolvedValueOnce({
      data: [{ id: 'pay_remote_1', status: 'PENDING', deleted: false }],
      totalCount: 1,
      hasMore: false,
      limit: 10,
      offset: 0,
      object: 'list',
    } as never);
    vi.mocked(syncPaymentStateFromAsaas).mockResolvedValueOnce({
      success: true,
      paymentStatus: 'PENDING',
      appliedEvent: 'PAYMENT_UPDATED',
    } as never);
    vi.mocked(getAsaasPaymentDetails).mockResolvedValueOnce({
      payment: {
        id: 'pay_remote_1',
        status: 'PENDING',
        invoiceUrl: 'https://asaas.test/i/pay_remote_1',
        bankSlipUrl: null,
      },
      pixQrCode: {
        encodedImage: 'abc123',
        payload: '000201010212...',
        expirationDate: '2026-04-02',
      },
      billingInfo: {
        pix: {
          encodedImage: 'abc123',
          payload: '000201010212...',
          expirationDate: '2026-04-02',
        },
      },
    } as never);

    const result = await resendTaxaMatricula({
      cobrancaId: 'cobranca-1',
      contaId: 'conta-1',
      actorId: 'user-1',
    });

    expect(createCharge).not.toHaveBeenCalled();
    expect(listPayments).toHaveBeenCalledWith(
      { externalReference: 'charge:cobranca-1', limit: 10 },
      { contaId: 'conta-1' },
    );
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_remote_1',
    });
    expect(result.newStatus).toBe('A_VENCER');
    expect(result.invoiceUrl).toBe('https://asaas.test/i/pay_remote_1');
    expect(result.pixQrCode).toBe('abc123');
    expect(result.pixCopyPaste).toBe('000201010212...');
  });

  it('cria payment oficial idempotente quando a taxa ainda não existe no Asaas', async () => {
    const { prisma } = await import('@alusa/database');
    const { listPayments } = await import('../asaas-ops');
    const { createCharge } = await import('../create-charge');
    const { syncPaymentStateFromAsaas } = await import('../sync-payment-state-from-asaas');
    const { getAsaasPaymentDetails } = await import('../get-asaas-payment-details');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.cobranca.findUnique)
      .mockResolvedValueOnce({
        id: 'cobranca-2',
        tipo: 'TAXA_MATRICULA',
        status: 'PENDENTE',
        vencimento: new Date('2026-03-31T03:00:00.000Z'),
        asaasPaymentId: null,
        matriculaId: 'matricula-2',
        matricula: {
          aluno: { contaId: 'conta-1' },
          taxaStatus: 'PENDENTE',
        },
      } as never)
      .mockResolvedValueOnce({
        status: 'PENDENTE',
        asaasPaymentId: 'pay_created_2',
        matricula: { taxaStatus: 'PENDENTE' },
      } as never);

    vi.mocked(listPayments).mockResolvedValueOnce({
      data: [],
      totalCount: 0,
      hasMore: false,
      limit: 10,
      offset: 0,
      object: 'list',
    } as never);
    vi.mocked(createCharge).mockResolvedValueOnce({
      success: true,
      data: {
        cobrancaId: 'cobranca-2',
        chargeId: 'cobranca-2',
        asaasPaymentId: 'pay_created_2',
        externalReference: 'charge:cobranca-2',
      },
    } as never);
    vi.mocked(syncPaymentStateFromAsaas).mockResolvedValueOnce({
      success: true,
      paymentStatus: 'PENDING',
      appliedEvent: 'PAYMENT_UPDATED',
    } as never);
    vi.mocked(getAsaasPaymentDetails).mockResolvedValueOnce({
      payment: {
        id: 'pay_created_2',
        status: 'PENDING',
        invoiceUrl: 'https://asaas.test/i/pay_created_2',
        bankSlipUrl: null,
      },
      pixQrCode: {
        encodedImage: 'base64qr',
        payload: 'pix-copia-cola',
        expirationDate: '2026-04-02',
      },
      billingInfo: {
        pix: {
          encodedImage: 'base64qr',
          payload: 'pix-copia-cola',
          expirationDate: '2026-04-02',
        },
      },
    } as never);

    const result = await resendTaxaMatricula({
      cobrancaId: 'cobranca-2',
      contaId: 'conta-1',
      actorId: 'user-1',
    });

    expect(createCharge).toHaveBeenCalledWith({
      contaId: 'conta-1',
      cobrancaId: 'cobranca-2',
      actor: { type: 'USER', id: 'user-1' },
      dueDateOverride: '2026-04-01',
    });
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_created_2',
    });
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.manual_resend.payment_reconciled',
        metadata: expect.objectContaining({
          resolutionSource: 'ASAAS_CREATE',
          dueDateOverride: '2026-04-01',
        }),
      }),
    );
    expect(result.invoiceUrl).toBe('https://asaas.test/i/pay_created_2');
    expect(result.pixQrCode).toBe('base64qr');
  });

  it('bloqueia quando o Asaas retorna pagamentos duplicados para a mesma externalReference', async () => {
    const { prisma } = await import('@alusa/database');
    const { listPayments } = await import('../asaas-ops');

    vi.mocked(prisma.cobranca.findUnique).mockResolvedValueOnce({
      id: 'cobranca-3',
      tipo: 'TAXA_MATRICULA',
      status: 'PENDENTE',
      vencimento: new Date('2026-04-01T03:00:00.000Z'),
      asaasPaymentId: null,
      matriculaId: 'matricula-3',
      matricula: {
        aluno: { contaId: 'conta-1' },
        taxaStatus: 'PENDENTE',
      },
    } as never);

    vi.mocked(listPayments).mockResolvedValueOnce({
      data: [
        { id: 'pay_dup_1', status: 'PENDING', deleted: false },
        { id: 'pay_dup_2', status: 'PENDING', deleted: false },
      ],
      totalCount: 2,
      hasMore: false,
      limit: 10,
      offset: 0,
      object: 'list',
    } as never);

    await expect(
      resendTaxaMatricula({
        cobrancaId: 'cobranca-3',
        contaId: 'conta-1',
        actorId: 'user-1',
      }),
    ).rejects.toMatchObject<Partial<ManualSyncError>>({
      code: 'ASAAS_PAYMENT_DUPLICATED',
      statusCode: 409,
    });
  });
});