import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from '../route';

const { createChargeMock, listChargesMock, getKycSummaryMock, getKycSummaryFreshMock, syncPaymentStateFromAsaasMock } =
  vi.hoisted(() => ({
    createChargeMock: vi.fn(async () => ({
      success: true,
      data: { cobrancaId: 'c1', chargeId: 'ch1', asaasPaymentId: 'p1', externalReference: 'charge:c1' },
    })),
    listChargesMock: vi.fn(async () => ({ items: [], total: 0 })),
    getKycSummaryMock: vi.fn(),
    getKycSummaryFreshMock: vi.fn(),
    syncPaymentStateFromAsaasMock: vi.fn(async () => ({ success: true, appliedEvent: 'PAYMENT_CREATED' })),
  }));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/finance')>();

  return {
    ...actual,
    listCharges: listChargesMock,
    createCharge: createChargeMock,
    getKycSummary: getKycSummaryMock,
    getKycSummaryFresh: getKycSummaryFreshMock,
    syncPaymentStateFromAsaas: syncPaymentStateFromAsaasMock,
  };
});

describe('GET/POST /api/finance/charges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getKycSummaryMock.mockResolvedValue({
      onboarding: {} as never,
      asaasConnection: { status: 'CONNECTED' },
      myAccountStatus: null,
      documents: null,
      documentsRequired: false,
    } as never);
    getKycSummaryFreshMock.mockResolvedValue({
      onboarding: {} as never,
      asaasConnection: { status: 'CONNECTED' },
      myAccountStatus: null,
      documents: null,
      documentsRequired: false,
    } as never);
    syncPaymentStateFromAsaasMock.mockResolvedValue({ success: true, appliedEvent: 'PAYMENT_CREATED' } as never);
  });

  it('GET deve retornar 401 se não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/finance/charges');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('NAO_AUTENTICADO');
  });

  it('GET deve retornar 403 se sem permissão', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'USER' },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/charges');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('SEM_PERMISSAO');
  });

  it('GET deve retornar lista', async () => {
    const { getServerSession } = await import('next-auth');
    const { listCharges } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'ADMIN' },
    } as never);

    vi.mocked(listCharges).mockResolvedValueOnce({ items: [{
      id: 'c1',
      cobrancaId: 'cb1',
      externalReference: 'charge:cb1',
      status: 'OPEN',
      statusUpdatedAt: new Date().toISOString(),
      asaasPaymentId: null,
      valor: 10,
      vencimento: new Date().toISOString(),
      matriculaId: 'm1',
      createdAt: new Date().toISOString(),
    }], total: 1 });

    const request = new NextRequest('http://localhost:3000/api/finance/charges?limit=10&offset=0');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.total).toBe(1);
    expect(listCharges).toHaveBeenCalledWith({ contaId: 't1', limit: 10, offset: 0 });
  });

  it('POST deve retornar 401 se não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/finance/charges', {
      method: 'POST',
      body: JSON.stringify({ cobrancaId: 'c1' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('NAO_AUTENTICADO');
  });

  it('POST deve chamar createCharge e retornar data', async () => {
    const { getServerSession } = await import('next-auth');
    const { createCharge } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'FINANCEIRO' },
    } as never);

    vi.mocked(createCharge).mockResolvedValueOnce({
      success: true,
      data: { cobrancaId: 'c1', chargeId: 'ch1', asaasPaymentId: 'p1', externalReference: 'charge:c1' },
    });

    const request = new NextRequest('http://localhost:3000/api/finance/charges', {
      method: 'POST',
      body: JSON.stringify({ cobrancaId: 'c1' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.asaasPaymentId).toBe('p1');
    expect(createCharge).toHaveBeenCalledWith({
      contaId: 't1',
      cobrancaId: 'c1',
      actor: { type: 'USER', id: 'u1' },
    });
  });

  it('POST deve retornar 409 quando KYC não está aprovado', async () => {
    const { getServerSession } = await import('next-auth');
    const { createCharge } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'FINANCEIRO' },
    } as never);

    vi.mocked(createCharge).mockResolvedValueOnce({
      success: false,
      error: 'KYC_NAO_APROVADO',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/charges', {
      method: 'POST',
      body: JSON.stringify({ cobrancaId: 'c1' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe('KYC_NAO_APROVADO');
  });
});
