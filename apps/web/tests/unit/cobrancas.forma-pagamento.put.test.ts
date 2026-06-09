/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cobranca: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    matricula: {
      findUnique: vi.fn(),
    },
    logFinanceiro: {
      create: vi.fn(),
    },
    webhookAsaas: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@alusa/finance', () => {
  class KycNotApprovedError extends Error {}
  class AsaasEnvError extends Error {}

  return {
    FORMA_PAGAMENTO_TO_ASAAS: {
      PIX: 'PIX',
      BOLETO: 'BOLETO',
      CARTAO_CREDITO: 'CREDIT_CARD',
      INDEFINIDO: 'UNDEFINED',
    },
    KycNotApprovedError,
    AsaasEnvError,
    isAsaasEnabled: vi.fn(() => true),
    readPaymentFullPreflight: vi.fn(async () => ({
      id: 'pay_1',
      status: 'PENDING',
      billingType: 'BOLETO',
      value: 100,
      dueDate: '2026-01-05',
    })),
    updatePayment: vi.fn(async () => {
      throw new KycNotApprovedError('KYC_NAO_APROVADO');
    }),
  };
});

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { readPaymentFullPreflight, updatePayment } from '@alusa/finance';
import { PUT } from '@/app/api/cobrancas/[id]/forma-pagamento/route';

const buildPutRequest = (url: string, body: unknown): NextRequest =>
  new Request(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe('PUT /api/cobrancas/[id]/forma-pagamento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 409 quando KYC não aprovado', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_1',
      matriculaId: 'mat-1',
      formaPagamento: 'BOLETO',
      matricula: {
        aluno: { contaId: 'conta-1' },
      },
    } as never);

    const res = await PUT(buildPutRequest('http://localhost/api/cobrancas/cob-1/forma-pagamento', { formaPagamento: 'PIX' }), {
      params: { id: 'cob-1' },
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, error: 'KYC_NAO_APROVADO' });

    expect(prisma.matricula.findUnique).not.toHaveBeenCalled();
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.logFinanceiro.create).not.toHaveBeenCalled();
  });

  it('retorna 409 com código de domínio quando cobrança já foi recebida em dinheiro no Asaas', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_1',
      matriculaId: 'mat-1',
      formaPagamento: 'BOLETO',
      matricula: {
        aluno: { contaId: 'conta-1' },
      },
    } as never);
    vi.mocked(readPaymentFullPreflight).mockResolvedValueOnce({
      id: 'pay_1',
      status: 'RECEIVED_IN_CASH',
      billingType: 'RECEIVED_IN_CASH',
      value: 100,
      dueDate: '2026-01-05',
    } as never);

    const res = await PUT(buildPutRequest('http://localhost/api/cobrancas/cob-1/forma-pagamento', { formaPagamento: 'PIX' }), {
      params: { id: 'cob-1' },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE',
      asaasStatus: 'RECEIVED_IN_CASH',
    });
    expect(updatePayment).not.toHaveBeenCalled();
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.logFinanceiro.create).not.toHaveBeenCalled();
  });

  it('sincroniza forma de pagamento de cobrança standalone no Asaas e no Charge local', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'charge-1',
      status: 'OPEN',
      asaasPaymentId: 'pay_1',
      value: 100,
      dueDate: new Date('2026-01-05T12:00:00Z'),
      billingType: 'BOLETO',
      invoiceUrl: 'https://sandbox.asaas.com/i/pay_1',
    } as never);
    vi.mocked(updatePayment).mockResolvedValueOnce({
      id: 'pay_1',
      status: 'PENDING',
      billingType: 'PIX',
      value: 100,
      dueDate: '2026-01-05',
    } as never);
    vi.mocked(prisma.charge.update).mockResolvedValueOnce({
      id: 'charge-1',
      billingType: 'PIX',
    } as never);

    const res = await PUT(buildPutRequest('http://localhost/api/cobrancas/charge-1/forma-pagamento', { formaPagamento: 'PIX' }), {
      params: { id: 'charge-1' },
    });

    expect(res.status).toBe(202);
    expect(updatePayment).toHaveBeenCalledWith(
      'pay_1',
      expect.objectContaining({
        billingType: 'PIX',
        value: 100,
        dueDate: '2026-01-05',
      }),
      { contaId: 'conta-1' },
    );
    expect(prisma.charge.update).toHaveBeenCalledWith({
      where: { id: 'charge-1' },
      data: expect.objectContaining({ billingType: 'PIX' }),
    });
  });
});
