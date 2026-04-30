/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

const mockGetSessionUser = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getSessionUser: () => mockGetSessionUser(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cobranca: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
    },
    logFinanceiro: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@alusa/finance', () => {
  class KycNotApprovedError extends Error {}
  class AsaasEnvError extends Error {}

  return {
    KycNotApprovedError,
    AsaasEnvError,
    buildStandaloneExternalReference: vi.fn(({ chargeId }: { chargeId: string }) => `alusa:standalone:${chargeId}`),
    isAsaasEnabled: vi.fn(() => true),
    readPaymentFullPreflight: vi.fn(async () => ({ id: 'pay_1', status: 'PENDING' })),
    deletePayment: vi.fn(async () => {
      throw new KycNotApprovedError('KYC_NAO_APROVADO');
    }),
    handlePaymentWebhook: vi.fn(async () => ({ success: true })),
    syncPaymentStateFromAsaas: vi.fn(async () => undefined),
    auditLogService: { record: vi.fn(async () => {}) },
  };
});

import { prisma } from '@/lib/prisma';
import { handlePaymentWebhook, readPaymentFullPreflight, syncPaymentStateFromAsaas } from '@alusa/finance';
import { DELETE } from '@/app/api/cobrancas/[id]/route';

describe('DELETE /api/cobrancas/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 409 quando KYC não aprovado e não deleta a cobrança no banco local', async () => {
    mockGetSessionUser.mockResolvedValue({
      id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1',
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_1',
      matricula: {
        aluno: { contaId: 'conta-1' },
      },
    } as never);

    const res = await DELETE(new NextRequest('http://localhost/api/cobrancas/cob-1'), {
      params: { id: 'cob-1' },
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, error: 'KYC_NAO_APROVADO' });

    expect(prisma.cobranca.update).not.toHaveBeenCalled();
  });

  it('converge imediatamente a charge standalone após delete no Asaas', async () => {
    mockGetSessionUser.mockResolvedValue({
      id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1',
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch-1',
      status: 'OPEN',
      asaasPaymentId: 'pay_1',
    } as never);

    const { deletePayment } = await import('@alusa/finance');
    vi.mocked(deletePayment).mockResolvedValueOnce({
      id: 'pay_1',
      status: 'PENDING',
      deleted: true,
      value: 100,
      netValue: 100,
      billingType: 'PIX',
      externalReference: 'alusa:standalone:ch-1',
      dueDate: '2026-03-09',
    } as never);

    const res = await DELETE(new NextRequest('http://localhost/api/cobrancas/ch-1'), {
      params: { id: 'ch-1' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, pending: false });

    expect(handlePaymentWebhook).toHaveBeenCalledWith(
      'conta-1',
      expect.objectContaining({
        event: 'PAYMENT_DELETED',
        payment: expect.objectContaining({
          id: 'pay_1',
          deleted: true,
        }),
      }),
    );
    expect(syncPaymentStateFromAsaas).not.toHaveBeenCalled();
  });

  it('permite cancelar cobrança acadêmica atrasada', async () => {
    mockGetSessionUser.mockResolvedValue({
      id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1',
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-atrasada',
      status: 'ATRASADO',
      asaasPaymentId: 'pay_overdue_1',
      matricula: {
        aluno: { contaId: 'conta-1' },
      },
    } as never);

    const { deletePayment } = await import('@alusa/finance');
    vi.mocked(readPaymentFullPreflight).mockResolvedValueOnce({
      id: 'pay_overdue_1',
      status: 'OVERDUE',
      deleted: false,
      value: 100,
      netValue: 100,
      billingType: 'BOLETO',
      dueDate: '2026-03-09',
    } as never);
    vi.mocked(deletePayment).mockResolvedValueOnce({
      id: 'pay_overdue_1',
      status: 'PENDING',
      deleted: true,
      value: 100,
      netValue: 100,
      billingType: 'BOLETO',
      dueDate: '2026-03-09',
    } as never);

    const res = await DELETE(new NextRequest('http://localhost/api/cobrancas/cob-atrasada'), {
      params: { id: 'cob-atrasada' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, pending: false });
    expect(deletePayment).toHaveBeenCalledWith('pay_overdue_1', { contaId: 'conta-1' });
  });

  it('reconcilia localmente quando a cobrança standalone já estava deletada no Asaas', async () => {
    mockGetSessionUser.mockResolvedValue({
      id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1',
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch-1',
      status: 'OPEN',
      asaasPaymentId: 'pay_1',
    } as never);

    const { deletePayment } = await import('@alusa/finance');
    vi.mocked(readPaymentFullPreflight).mockResolvedValueOnce({
      id: 'pay_1',
      status: 'PENDING',
      deleted: true,
      value: 100,
      netValue: 100,
      billingType: 'PIX',
      externalReference: 'alusa:standalone:ch-1',
      dueDate: '2026-03-09',
    } as never);

    const res = await DELETE(new NextRequest('http://localhost/api/cobrancas/ch-1'), {
      params: { id: 'ch-1' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, pending: false });

    expect(handlePaymentWebhook).toHaveBeenCalledWith(
      'conta-1',
      expect.objectContaining({
        event: 'PAYMENT_DELETED',
      }),
    );
    expect(deletePayment).not.toHaveBeenCalled();
  });
});
