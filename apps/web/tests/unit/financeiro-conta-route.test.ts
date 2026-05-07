import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { GET } from '@/app/api/financeiro/conta/route';

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({
    ok: true,
    summary: { asaasConnection: { status: 'CONNECTED' } },
  })),
}));

vi.mock('@alusa/finance', () => ({
  getAccountBalanceSummary: vi.fn(),
  getAccountOverview: vi.fn(),
}));

async function mockSession(user: Record<string, string> | null) {
  const mod = await import('@/lib/safe-server-session');
  vi.mocked(mod.safeGetServerSession).mockResolvedValue(user ? ({ user } as never) : null);
}

describe('GET /api/financeiro/conta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando nao autenticado', async () => {
    await mockSession(null);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('retorna 403 quando sem permissao', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'USER' });

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('repassa bloqueio do gate financeiro', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'ADMIN' });
    const gate = await import('@/lib/finance/financial-account-gate');
    vi.mocked(gate.guardFinancialAccountOr412).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'KYC_PENDENTE' }, { status: 412 }),
    } as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(412);
    expect(body.error).toBe('KYC_PENDENTE');
  });

  it('retorna overview quando sucesso', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });
    const finance = await import('@alusa/finance');
    vi.mocked(finance.getAccountOverview).mockResolvedValueOnce({
      success: true,
      data: {
        balance: { available: 91.23, syncedAt: '2026-03-23T20:00:00.000Z' },
        financialAccount: {
          status: 'READY',
          canTransfer: true,
          canPixCopyPaste: true,
          reasonCode: null,
        },
        features: {
          manualWithdrawEnabled: true,
          pixTransferEnabled: true,
          bankTransferEnabled: true,
        },
        fees: null,
        statementPreview: {
          summary: { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
          items: [],
        },
        recentTransfers: { items: [], total: 0 },
      },
    } as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.balance.available).toBe(91.23);
    expect(finance.getAccountOverview).toHaveBeenCalledWith({ contaId: 'c1' });
  });

  it('retorna summary leve e usa cache antes do gate em chamadas repetidas', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'FINANCEIRO' });
    const finance = await import('@alusa/finance');
    const gate = await import('@/lib/finance/financial-account-gate');
    vi.mocked(finance.getAccountBalanceSummary).mockResolvedValueOnce({
      success: true,
      data: {
        balance: { available: 91.23, syncedAt: '2026-03-23T20:00:00.000Z' },
        financialAccount: {
          status: 'READY',
          canTransfer: true,
          canPixCopyPaste: true,
          reasonCode: null,
        },
        features: {
          manualWithdrawEnabled: true,
          pixTransferEnabled: true,
          bankTransferEnabled: true,
        },
      },
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/financeiro/conta?mode=summary'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-alusa-cache')).toBe('MISS');
    expect(body.data.balance.available).toBe(91.23);
    expect(body.data.statementPreview).toBeUndefined();
    expect(gate.guardFinancialAccountOr412).toHaveBeenCalledTimes(1);
    expect(finance.getAccountBalanceSummary).toHaveBeenCalledWith({
      contaId: 'c1',
      kycSummary: { asaasConnection: { status: 'CONNECTED' } },
    });
    expect(finance.getAccountOverview).not.toHaveBeenCalled();

    const cachedResponse = await GET(new NextRequest('http://localhost/api/financeiro/conta?mode=summary'));
    const cachedBody = await cachedResponse.json();

    expect(cachedResponse.status).toBe(200);
    expect(cachedResponse.headers.get('x-alusa-cache')).toBe('HIT');
    expect(cachedBody.data.balance.available).toBe(91.23);
    expect(gate.guardFinancialAccountOr412).toHaveBeenCalledTimes(1);
    expect(finance.getAccountBalanceSummary).toHaveBeenCalledTimes(1);
  });

  it('retorna 503 quando credenciais nao estao configuradas', async () => {
    await mockSession({ id: 'u1', contaId: 'c1', role: 'ADMIN' });
    const finance = await import('@alusa/finance');
    vi.mocked(finance.getAccountOverview).mockResolvedValueOnce({
      success: false,
      error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS',
    } as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
  });
});
