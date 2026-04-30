import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({
    ok: true,
    summary: {
      asaasConnection: { status: 'CONNECTED' },
    },
  })),
}));

vi.mock('@alusa/finance', () => ({
  getBalance: vi.fn(async () => ({ success: true, data: { balance: 123.45 } })),
}));

describe('GET /api/finance/balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar 401 se não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/finance/balance');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('NAO_AUTENTICADO');
  });

  it('deve retornar 403 se sem permissão', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'USER' },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/balance');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('SEM_PERMISSAO');
  });

  it('deve retornar saldo', async () => {
    const { getServerSession } = await import('next-auth');
    const { getBalance } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'FINANCEIRO' },
    } as never);

    vi.mocked(getBalance).mockResolvedValueOnce({ success: true, data: { balance: 10 } });

    const request = new NextRequest('http://localhost:3000/api/finance/balance');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.balance).toBe(10);
    expect(getBalance).toHaveBeenCalledWith({ contaId: 't1' });
  });

  it('deve retornar 503 se credenciais não configuradas', async () => {
    const { getServerSession } = await import('next-auth');
    const { getBalance } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'ADMIN' },
    } as never);

    vi.mocked(getBalance).mockResolvedValueOnce({ success: false, error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' });

    const request = new NextRequest('http://localhost:3000/api/finance/balance');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
  });
});
