import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCharge } from '../create-charge';

vi.mock('@alusa/database', () => {
  return {
    prisma: {
      asaasAccount: {
        findUnique: vi.fn(),
      },
      cobranca: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      charge: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('../../foundation/finance-profile.service', () => ({
  financeProfileService: {
    getOrCreateByTenant: vi.fn(),
  },
}));

vi.mock('../ensure-customer', () => ({
  ensureCustomer: vi.fn(async () => ({ success: true, data: { customerId: 'cust_1', externalReference: 'customer:r1' } })),
}));

vi.mock('../create-payment', () => ({
  createAsaasPayment: vi.fn(async () => ({ success: true, data: { id: 'pay_1', externalReference: 'charge:c1' } })),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

describe('createCharge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve bloquear quando KYC não está aprovado', async () => {
    const { prisma } = await import('@alusa/database');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');
    const { ensureCustomer } = await import('../ensure-customer');
    const { createAsaasPayment } = await import('../create-payment');

    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'IN_PROGRESS' } as never);

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER', id: 'u1' } });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('KYC_NAO_APROVADO');

    expect(ensureCustomer).not.toHaveBeenCalled();
    expect(createAsaasPayment).not.toHaveBeenCalled();
  });

  it('deve ser idempotente quando asaasPaymentId já existe', async () => {
    const { prisma } = await import('@alusa/database');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');

    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'APPROVED' } as never);
    vi.mocked(prisma.charge.findUnique).mockResolvedValueOnce(null as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c1',
      asaasPaymentId: 'pay_existing',
      asaasId: null,
      valor: 10,
      vencimento: new Date('2099-01-01T00:00:00.000Z'),
      descricao: null,
      formaPagamento: 'BOLETO',
      matricula: {
        id: 'm1',
        responsavelFinanceiroId: 'r1',
        aluno: { id: 'a1', cpf: '83750216010', dataNasc: new Date('2000-01-01T00:00:00.000Z') },
        responsavelFinanceiro: { id: 'r1', cpf: '83750216010' },
      },
    } as never);

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER', id: 'u1' } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.asaasPaymentId).toBe('pay_existing');
      expect(result.data.externalReference).toBe('charge:c1');
      expect(result.data.chargeId).toBe('c1');
    }

    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
  });

  it('deve criar payment oficial e aguardar materialização via webhook', async () => {
    const { prisma } = await import('@alusa/database');
    const { createAsaasPayment } = await import('../create-payment');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'APPROVED' } as never);
    vi.mocked(prisma.charge.findUnique).mockResolvedValueOnce(null as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c1',
      asaasPaymentId: null,
      asaasId: null,
      valor: 10,
      vencimento: new Date('2099-01-01T00:00:00.000Z'),
      descricao: 'Teste',
      formaPagamento: 'PIX',
      matricula: {
        id: 'm1',
        responsavelFinanceiroId: 'r1',
        aluno: { id: 'a1', cpf: '83750216010', dataNasc: new Date('2000-01-01T00:00:00.000Z') },
        responsavelFinanceiro: { id: 'r1', cpf: '83750216010' },
      },
    } as never);

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER', id: 'u1' } });

    expect(result.success).toBe(true);
    expect(createAsaasPayment).toHaveBeenCalled();
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.charge.payment_requested',
        entity: { type: 'Cobranca', id: 'c1' },
        metadata: expect.objectContaining({
          asaasPaymentId: 'pay_1',
          awaitingOfficialMaterialization: true,
        }),
      }),
    );
  });
});
