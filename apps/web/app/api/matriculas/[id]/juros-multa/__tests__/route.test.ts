/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServerSessionMock,
  getSubscriptionMock,
  listSubscriptionPaymentsMock,
  updateSubscriptionMock,
  updatePaymentMock,
  prismaMock,
  resolveMatriculaFinancialContextMock,
  updateFamilyFinancialLocalStateMock,
  alignLocalPendingEnrollmentChargesMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  listSubscriptionPaymentsMock: vi.fn(),
  updateSubscriptionMock: vi.fn(),
  updatePaymentMock: vi.fn(),
  prismaMock: {
    matricula: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
    matriculaLog: {
      create: vi.fn(),
    },
  },
  resolveMatriculaFinancialContextMock: vi.fn(),
  updateFamilyFinancialLocalStateMock: vi.fn(),
  alignLocalPendingEnrollmentChargesMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  getSubscription: getSubscriptionMock,
  listSubscriptionPayments: listSubscriptionPaymentsMock,
  updateSubscription: updateSubscriptionMock,
  updatePayment: updatePaymentMock,
  KycNotApprovedError: class KycNotApprovedError extends Error {},
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/src/server/matriculas/financial-context.service', () => ({
  isFinancialContextEditable: vi.fn(() => true),
  resolveMatriculaFinancialContext: resolveMatriculaFinancialContextMock,
  updateFamilyFinancialLocalState: updateFamilyFinancialLocalStateMock,
}));

vi.mock('@/src/server/matriculas/enrollment-finance-consistency.service', () => ({
  alignLocalPendingEnrollmentCharges: alignLocalPendingEnrollmentChargesMock,
}));

const { PUT } = await import('../route');

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/matriculas/mat-1/juros-multa', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/matriculas/[id]/juros-multa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1' },
    });
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: 'sub_123',
    });
    prismaMock.subscription.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    resolveMatriculaFinancialContextMock.mockResolvedValue({
      mode: 'INDIVIDUAL',
      sourceMatriculaId: 'mat-1',
      targetMatriculaId: 'mat-1',
      contaId: 'conta-1',
      asaasSubscriptionId: 'sub_123',
      localSnapshot: { status: 'ACTIVE', deleted: false },
      family: null,
    });
    prismaMock.matricula.update.mockResolvedValue({
      jurosMensal: 0,
      jurosTipo: 'PERCENTAGE',
      multaPercentual: 0,
      multaTipo: 'PERCENTAGE',
      descontoAntecipado: 0,
      descontoTipo: null,
      prazoDesconto: null,
    });
    alignLocalPendingEnrollmentChargesMock.mockResolvedValue({
      cobrancasUpdated: 0,
      chargesUpdated: 0,
    });
    listSubscriptionPaymentsMock
      .mockResolvedValueOnce({
        data: [
          {
            id: 'pay_pending',
            value: 150,
            dueDate: '2026-06-10',
            billingType: 'BOLETO',
            deleted: false,
          },
        ],
        hasMore: false,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'pay_overdue',
            value: 150,
            dueDate: '2026-05-10',
            billingType: 'BOLETO',
            deleted: false,
          },
        ],
        hasMore: false,
      });
    updatePaymentMock.mockResolvedValue({});
  });

  it('envia juros, multa, desconto e updatePendingPayments no PUT da assinatura Asaas', async () => {
    updateSubscriptionMock.mockResolvedValue({
      id: 'sub_123',
      interest: { value: 0 },
      fine: { value: 0, type: 'PERCENTAGE' },
      discount: { value: 0, type: 'PERCENTAGE', dueDateLimitDays: 5 },
    });

    const response = await PUT(
      buildRequest({
        interest: { value: 0 },
        fine: { value: 0, type: 'PERCENTAGE' },
        discount: { value: 0, type: 'PERCENTAGE', dueDateLimitDays: 5 },
      }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateSubscriptionMock).toHaveBeenCalledWith(
      'sub_123',
      {
        interest: { value: 0 },
        fine: { value: 0, type: 'PERCENTAGE' },
        discount: { value: 0, type: 'PERCENTAGE', dueDateLimitDays: 5 },
        updatePendingPayments: true,
      },
      { contaId: 'conta-1' },
    );
    expect(getSubscriptionMock).not.toHaveBeenCalled();
    expect(listSubscriptionPaymentsMock).toHaveBeenCalledWith('sub_123', {
      contaId: 'conta-1',
      status: 'PENDING',
      limit: 100,
      offset: 0,
    });
    expect(listSubscriptionPaymentsMock).toHaveBeenCalledWith('sub_123', {
      contaId: 'conta-1',
      status: 'OVERDUE',
      limit: 100,
      offset: 0,
    });
    expect(updatePaymentMock).toHaveBeenCalledWith(
      'pay_pending',
      {
        billingType: 'BOLETO',
        value: 150,
        dueDate: '2026-06-10',
        interest: { value: 0 },
        fine: { value: 0, type: 'PERCENTAGE' },
        discount: { value: 0, type: 'PERCENTAGE', dueDateLimitDays: 5 },
      },
      { contaId: 'conta-1' },
    );
    expect(updatePaymentMock).toHaveBeenCalledWith(
      'pay_overdue',
      {
        billingType: 'BOLETO',
        value: 150,
        dueDate: '2026-05-10',
        interest: { value: 0 },
        fine: { value: 0, type: 'PERCENTAGE' },
        discount: { value: 0, type: 'PERCENTAGE', dueDateLimitDays: 5 },
      },
      { contaId: 'conta-1' },
    );
  });
});
