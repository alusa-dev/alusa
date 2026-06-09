/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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
    $transaction: vi.fn(),
    cobranca: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@alusa/finance', () => {
  class KycNotApprovedError extends Error {}
  class AsaasEnvError extends Error {}
  const evaluatePaymentActionPolicy = (input: { localStatus?: string | null; asaasStatus?: string | null }) => {
    const status = String(input.asaasStatus ?? input.localStatus ?? '').toUpperCase();
    const editable = ['PENDING', 'OVERDUE', 'PENDENTE', 'A_VENCER', 'ATRASADO', 'OPEN', 'CREATED'].includes(status);
    const canEdit = editable;
    return {
      canEdit,
      actions: {
        EDIT: canEdit
          ? { allowed: true }
          : { allowed: false, code: 'EDIT_NOT_ALLOWED_FOR_ASAAS_STATUS', reason: `Não é possível editar cobrança com status ${status} no Asaas.` },
      },
    };
  };

  return {
    KycNotApprovedError,
    AsaasEnvError,
    evaluatePaymentActionPolicy,
    isAsaasEnabled: vi.fn(() => true),
    readPaymentFullPreflight: vi.fn(async () => ({
      id: 'pay_1',
      status: 'PENDING',
      billingType: 'BOLETO',
      value: 100,
      dueDate: '2026-01-05',
    })),
    expectedEventsForPaymentCommand: vi.fn(() => ['PAYMENT_UPDATED']),
    registerPaymentCommand: vi.fn(async () => ({ id: 'job-1' })),
    markPaymentCommandSent: vi.fn(async () => undefined),
    failPaymentCommand: vi.fn(async () => undefined),
    updatePayment: vi.fn(async () => {
      throw new KycNotApprovedError('KYC_NAO_APROVADO');
    }),
  };
});

import { prisma } from '@/lib/prisma';
import { readPaymentFullPreflight, updatePayment } from '@alusa/finance';
import { PUT } from '@/app/api/cobrancas/[id]/route';

const buildPutRequest = (url: string, body: unknown): NextRequest =>
  new Request(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe('PUT /api/cobrancas/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback({
        cobranca: {
          findFirst: vi.fn(async () => ({ id: 'cob-1' })),
          update: vi.fn(async (_args) => ({
            id: 'cob-1',
            status: 'PENDENTE',
            valor: 100,
          })),
        },
      } as never),
    );
  });

  it('retorna 409 quando KYC não aprovado e não atualiza o banco local', async () => {
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

    const res = await PUT(
      buildPutRequest('http://localhost/api/cobrancas/cob-1', {
        valor: 200,
        vencimento: '2026-01-10',
        descricao: 'Teste',
      }),
      { params: { id: 'cob-1' } },
    );

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ success: false, error: 'KYC_NAO_APROVADO' });

    expect(prisma.cobranca.update).not.toHaveBeenCalled();
  });

  it('retorna 409 com código de domínio ao editar cobrança recebida em dinheiro no Asaas', async () => {
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
    vi.mocked(readPaymentFullPreflight).mockResolvedValueOnce({
      id: 'pay_1',
      status: 'RECEIVED_IN_CASH',
      billingType: 'RECEIVED_IN_CASH',
      value: 100,
      dueDate: '2026-01-05',
    } as never);

    const res = await PUT(
      buildPutRequest('http://localhost/api/cobrancas/cob-1', {
        valor: 200,
      }),
      { params: { id: 'cob-1' } },
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE',
      asaasStatus: 'RECEIVED_IN_CASH',
    });
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
  });

  it('zera prazo do desconto no Asaas e localmente quando o desconto está em zero', async () => {
    mockGetSessionUser.mockResolvedValue({
      id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1',
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_1',
      valor: 100,
      vencimento: new Date('2026-01-05T12:00:00Z'),
      formaPagamento: 'BOLETO',
      tipo: 'AVULSA',
      matricula: {
        aluno: { contaId: 'conta-1' },
      },
    } as never);
    vi.mocked(updatePayment).mockResolvedValueOnce({
      id: 'pay_1',
      status: 'PENDING',
      billingType: 'BOLETO',
      value: 100,
      dueDate: '2026-01-05',
    } as never);

    let updateArgs: unknown;
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback) =>
      callback({
        cobranca: {
          findFirst: vi.fn(async () => ({ id: 'cob-1' })),
          update: vi.fn(async (args) => {
            updateArgs = args;
            return {
              id: 'cob-1',
              status: 'PENDENTE',
              valor: 100,
              descontoPrazoMaximo: args.data.descontoPrazoMaximo,
            };
          }),
        },
      } as never),
    );

    const res = await PUT(
      buildPutRequest('http://localhost/api/cobrancas/cob-1', {
        descontoTipo: 'PERCENTUAL',
        descontoPercentual: 0,
        descontoPrazoMaximo: '9_DIAS',
        desconto: 0,
      }),
      { params: { id: 'cob-1' } },
    );

    expect(res.status).toBe(202);
    expect(updatePayment).toHaveBeenCalledWith(
      'pay_1',
      expect.objectContaining({
        discount: {
          value: 0,
          type: 'PERCENTAGE',
          dueDateLimitDays: 0,
        },
      }),
      { contaId: 'conta-1' },
    );
    expect(updateArgs).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          descontoPrazoMaximo: 'ATE_VENCIMENTO',
        }),
      }),
    );
  });
});
