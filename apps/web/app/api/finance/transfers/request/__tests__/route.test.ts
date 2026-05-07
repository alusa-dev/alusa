import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '../route';

const { requestWithdrawMock, getKycSummaryMock, getKycSummaryFreshMock } = vi.hoisted(() => ({
  requestWithdrawMock: vi.fn(async () => ({
    success: true,
    data: {
      transferRequestId: 'tr1',
      externalReference: 'transfer:tr1',
      asaasTransferId: 'asaas_tr_1',
      status: 'PENDING',
    },
  })),
  getKycSummaryMock: vi.fn(),
  getKycSummaryFreshMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-service', () => ({
  verifyCredentialsDetailed: vi.fn(),
}));

vi.mock('@alusa/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/finance')>();

  return {
    ...actual,
    requestWithdraw: requestWithdrawMock,
    getKycSummary: getKycSummaryMock,
    getKycSummaryFresh: getKycSummaryFreshMock,
  };
});

describe('POST /api/finance/transfers/request', () => {
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
  });

  it('deve retornar 401 se não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/finance/transfers/request', {
      method: 'POST',
      body: JSON.stringify({
        amount: '10.00',
        destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      }),
      headers: { 'Idempotency-Key': 'k1' },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('NAO_AUTENTICADO');
  });

  it('deve retornar 403 se sem permissão', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'USER' },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/transfers/request', {
      method: 'POST',
      body: JSON.stringify({
        value: 10,
        destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      }),
      headers: { 'Idempotency-Key': 'k1' },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('SEM_PERMISSAO');
  });

  it('deve retornar 400 se Idempotency-Key ausente', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'FINANCEIRO' },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/transfers/request', {
      method: 'POST',
      body: JSON.stringify({
        amount: '10.00',
        destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('IDEMPOTENCY_KEY_OBRIGATORIO');
  });

  it('deve retornar 401 quando a sessão não possui email para reautenticar', async () => {
    const { getServerSession } = await import('next-auth');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'FINANCEIRO', email: null },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/transfers/request', {
      method: 'POST',
      body: JSON.stringify({
        amount: '10.00',
        currentPassword: '123456',
        destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      }),
      headers: { 'Idempotency-Key': 'k1', 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('REAUTENTICACAO_INDISPONIVEL');
  });

  it('deve retornar 409 quando a chave de idempotência colide com payload diferente', async () => {
    const { getServerSession } = await import('next-auth');
    const { verifyCredentialsDetailed } = await import('@/lib/auth-service');
    const { requestWithdraw } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'FINANCEIRO', email: 'financeiro@alusa.test' },
    } as never);

    vi.mocked(requestWithdraw).mockResolvedValueOnce({
      success: false,
      error: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
    } as never);
    vi.mocked(verifyCredentialsDetailed).mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'u1',
        email: 'financeiro@alusa.test',
        nome: 'Financeiro',
        role: 'FINANCEIRO',
        contaId: 't1',
        emailVerifiedAt: null,
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/transfers/request', {
      method: 'POST',
      body: JSON.stringify({
        amount: '10.00',
        currentPassword: '123456',
        destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      }),
      headers: { 'Idempotency-Key': 'k1', 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe('IDEMPOTENCY_PAYLOAD_CONFLICT');
  });

  it('deve chamar requestWithdraw e retornar data', async () => {
    const { getServerSession } = await import('next-auth');
    const { verifyCredentialsDetailed } = await import('@/lib/auth-service');
    const { requestWithdraw } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'FINANCEIRO', email: 'financeiro@alusa.test' },
    } as never);
    vi.mocked(verifyCredentialsDetailed).mockResolvedValueOnce({
      ok: true,
      user: {
        id: 'u1',
        email: 'financeiro@alusa.test',
        nome: 'Financeiro',
        role: 'FINANCEIRO',
        contaId: 't1',
        emailVerifiedAt: null,
      },
    } as never);

    vi.mocked(requestWithdraw).mockResolvedValueOnce({
      success: true,
      data: {
        transferRequestId: 'tr1',
        externalReference: 'transfer:tr1',
        asaasTransferId: 'asaas_tr_1',
        status: 'PENDING',
      },
    });

    const request = new NextRequest('http://localhost:3000/api/finance/transfers/request', {
      method: 'POST',
      body: JSON.stringify({
        amount: '10.00',
        currentPassword: '123456',
        destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
        description: 'Teste',
        scheduleDate: '2026-01-10',
      }),
      headers: { 'Idempotency-Key': 'k1', 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.externalReference).toBe('transfer:tr1');
    expect(requestWithdraw).toHaveBeenCalledWith({
      contaId: 't1',
      value: 10,
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
      description: 'Teste',
      scheduleDate: '2026-01-10',
      idempotencyKey: 'k1',
      actor: { type: 'USER', id: 'u1' },
    });
  });
});
