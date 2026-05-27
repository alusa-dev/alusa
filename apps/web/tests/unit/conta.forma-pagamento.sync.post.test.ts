import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getServerSessionMock,
  prismaMock,
  getSubscriptionMock,
  getPaymentMock,
  recordAsaasReadIntentMock,
  recordAsaasReadDecisionMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  prismaMock: {
    responsavel: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    matricula: {
      findFirst: vi.fn(),
    },
    cobranca: {
      findFirst: vi.fn(),
    },
  },
  getSubscriptionMock: vi.fn(),
  getPaymentMock: vi.fn(),
  recordAsaasReadIntentMock: vi.fn(),
  recordAsaasReadDecisionMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

vi.mock('@alusa/finance', () => ({
  getSubscription: getSubscriptionMock,
  getPayment: getPaymentMock,
  recordAsaasReadIntent: recordAsaasReadIntentMock,
}));

vi.mock('@/src/server/finance/asaas-read-observability', () => ({
  recordAsaasReadDecision: recordAsaasReadDecisionMock,
}));

import { POST } from '@/app/api/conta/forma-pagamento/sync/route';

function buildRequest(url: string): NextRequest {
  return new NextRequest(url, { method: 'POST' });
}

describe('POST /api/conta/forma-pagamento/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'RESPONSAVEL', contaId: 'conta-1' },
    });
  });

  it('retorna snapshot local sem consultar o Asaas quando já há dados locais', async () => {
    prismaMock.responsavel.findFirst.mockResolvedValue({
      id: 'resp-1',
      asaasCustomerId: 'cus-1',
      preferredBillingType: 'PIX',
      creditCardBrand: 'VISA',
      creditCardLast4: '4242',
    });

    const res = await POST(buildRequest('http://localhost/api/conta/forma-pagamento/sync'));

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(getSubscriptionMock).not.toHaveBeenCalled();
    expect(getPaymentMock).not.toHaveBeenCalled();
    expect(recordAsaasReadDecisionMock).toHaveBeenCalledWith('payment_method_sync', 'local');
    expect(json).toMatchObject({
      synced: true,
      cardSynced: true,
      billingTypeSynced: true,
      data: {
        billingType: 'PIX',
        creditCard: {
          brand: 'VISA',
          last4: '4242',
        },
      },
    });
  });

  it('consulta o Asaas quando fresh=1 e sincroniza billingType e cartão', async () => {
    prismaMock.responsavel.findFirst.mockResolvedValue({
      id: 'resp-1',
      asaasCustomerId: 'cus-1',
      preferredBillingType: null,
      creditCardBrand: null,
      creditCardLast4: null,
    });
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: 'sub-1',
    });
    getSubscriptionMock.mockResolvedValue({
      id: 'sub-1',
      billingType: 'CREDIT_CARD',
    });
    prismaMock.responsavel.update.mockResolvedValue({});
    prismaMock.cobranca.findFirst.mockResolvedValue({
      asaasPaymentId: 'pay-1',
    });
    getPaymentMock.mockResolvedValue({
      id: 'pay-1',
      billingType: 'CREDIT_CARD',
      creditCard: {
        creditCardBrand: 'VISA',
        creditCardNumber: '4242',
      },
    });

    const res = await POST(buildRequest('http://localhost/api/conta/forma-pagamento/sync?fresh=1'));

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(recordAsaasReadDecisionMock).toHaveBeenCalledWith('payment_method_sync', 'fresh_remote');
    expect(recordAsaasReadIntentMock).toHaveBeenCalledWith('MANUAL_REPAIR');
    expect(getSubscriptionMock).toHaveBeenCalledWith('sub-1', { contaId: 'conta-1' });
    expect(getPaymentMock).toHaveBeenCalledWith('pay-1', { contaId: 'conta-1' });
    expect(json).toMatchObject({
      synced: true,
      billingTypeSynced: true,
      cardSynced: true,
      data: {
        billingType: 'CREDIT_CARD',
        creditCard: {
          brand: 'VISA',
          last4: '4242',
        },
      },
    });
  });
});
