/**
 * Testes unitários para /api/finance/subscriptions
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { NextRequest as NextRequestCtor } from 'next/server';

import { GET, POST } from '@/app/api/finance/subscriptions/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance', async () => {
  const actual = await vi.importActual<typeof import('@alusa/finance')>('@alusa/finance');
  return {
    ...actual,
    getKycSummary: vi.fn(),
    createSubscription: vi.fn(),
    listSubscriptions: vi.fn(),
  };
});

const { getServerSession } = await import('next-auth');
const { createSubscription, listSubscriptions, getKycSummary } = await import('@alusa/finance');

function mockSession(user: { id?: string; contaId?: string; role?: string } | null) {
  vi.mocked(getServerSession).mockResolvedValueOnce(user ? ({ user } as never) : (null as never));
}

function makeGetReq(url: string) {
  return { url } as unknown as NextRequest;
}

function makePostReq(body: unknown) {
  const url = new URL('http://localhost:3001/api/finance/subscriptions');
  return new NextRequestCtor(url.toString(), {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

describe('API Finance Subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getKycSummary).mockResolvedValue({
      onboarding: {} as never,
      asaasConnection: { status: 'CONNECTED' },
      myAccountStatus: null,
      documents: null,
    } as never);
  });

  it('GET: 401 quando não autenticado', async () => {
    mockSession(null);

    const res = await GET(makeGetReq('http://test/api/finance/subscriptions'));
    expect(res.status).toBe(401);
  });

  it('GET: 403 quando sem permissão', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'PROFESSOR' });

    const res = await GET(makeGetReq('http://test/api/finance/subscriptions'));
    expect(res.status).toBe(403);
  });

  it('GET: 400 quando query inválida', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    const res = await GET(makeGetReq('http://test/api/finance/subscriptions?status=INVALID'));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    expect(listSubscriptions).not.toHaveBeenCalled();
  });

  it('GET: aplica filtro por status e paginação', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(listSubscriptions).mockResolvedValueOnce({
      total: 12,
      items: [],
    } as never);

    const res = await GET(
      makeGetReq('http://test/api/finance/subscriptions?page=2&pageSize=5&status=ACTIVE'),
    );

    expect(res.status).toBe(200);
    expect(listSubscriptions).toHaveBeenCalledWith({
      contaId: 'c1',
      limit: 5,
      offset: 5,
      status: 'ACTIVE',
    });
  });

  it('POST: 400 quando body inválido', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    const res = await POST(makePostReq({}));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('POST: 403 quando feature flag desabilitada', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(createSubscription).mockResolvedValueOnce({
      success: false,
      error: 'FEATURE_DISABLED',
    } as never);

    const res = await POST(
      makePostReq({
        contratoId: 'ct1',
        matriculaId: 'm1',
        amount: '10.00',
        nextDueDate: '2099-01-10',
        billingType: 'BOLETO',
        cycle: 'MONTHLY',
      }),
    );

    expect(res.status).toBe(403);
  });

  it('POST: 409 quando KYC não aprovado', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(createSubscription).mockResolvedValueOnce({
      success: false,
      error: 'KYC_NAO_APROVADO',
    } as never);

    const res = await POST(
      makePostReq({
        contratoId: 'ct1',
        matriculaId: 'm1',
        amount: '10.00',
        nextDueDate: '2099-01-10',
        billingType: 'BOLETO',
        cycle: 'MONTHLY',
      }),
    );

    expect(res.status).toBe(409);
  });

  it('POST: 200 no sucesso', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });

    vi.mocked(createSubscription).mockResolvedValueOnce({
      success: true,
      data: {
        subscriptionId: 's1',
        externalReference: 'subscription:s1',
        asaasSubscriptionId: 'asaas_sub_1',
        status: 'REQUESTED',
        createdAt: '2099-01-01T00:00:00.000Z',
        statusUpdatedAt: '2099-01-01T00:00:00.000Z',
      },
    } as never);

    const res = await POST(
      makePostReq({
        contratoId: 'ct1',
        matriculaId: 'm1',
        amount: '10.00',
        nextDueDate: '2099-01-10',
        billingType: 'BOLETO',
        cycle: 'MONTHLY',
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      data: {
        id: 's1',
        externalReference: 'subscription:s1',
        asaasSubscriptionId: 'asaas_sub_1',
        status: 'REQUESTED',
        amount: '10.00',
      },
    });
  });
});
