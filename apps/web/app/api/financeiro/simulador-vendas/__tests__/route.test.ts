/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@alusa/finance', () => ({
  simulatePaymentFees: vi.fn(),
  paymentSimulationInputDTOSchema: {
    parse: (value: Record<string, unknown>) => ({
      value: Number(value.value),
      installmentCount: Number(value.installmentCount),
      passFeesToCustomer: Boolean(value.passFeesToCustomer),
    }),
  },
}));

const { POST } = await import('../route');

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/financeiro/simulador-vendas', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function mockSession(user: Record<string, string> | null) {
  const mod = await import('@/lib/safe-server-session');
  vi.mocked(mod.safeGetServerSession).mockResolvedValue(user ? ({ user } as never) : null);
}

describe('POST /api/financeiro/simulador-vendas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 sem sessão', async () => {
    await mockSession(null);

    const response = await POST(buildRequest({ value: 300, installmentCount: 1 }));
    expect(response.status).toBe(401);
  });

  it('usa o contaId da sessão e retorna a simulação', async () => {
    await mockSession({ id: 'user-1', contaId: 'conta-1', role: 'FINANCEIRO' });
    const finance = await import('@alusa/finance');
    vi.mocked(finance.simulatePaymentFees).mockResolvedValueOnce({
      success: true,
      data: {
        requestedValue: 300,
        simulatedValue: 300,
        installmentCount: 1,
        passFeesToCustomer: false,
        paymentValue: 300,
        paymentNetValue: 290.54,
        feeValue: 9.46,
        feePercentage: 2.99,
        operationFee: 0.49,
      },
    } as never);

    const response = await POST(buildRequest({ value: 300, installmentCount: 1 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { paymentNetValue: 290.54 } });
    expect(finance.simulatePaymentFees).toHaveBeenCalledWith({
      contaId: 'conta-1',
      input: { value: 300, installmentCount: 1, passFeesToCustomer: false },
    });
  });

  it('mapeia credencial ausente para 503', async () => {
    await mockSession({ id: 'user-1', contaId: 'conta-1', role: 'ADMIN' });
    const finance = await import('@alusa/finance');
    vi.mocked(finance.simulatePaymentFees).mockResolvedValueOnce({
      success: false,
      error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS',
    } as never);

    const response = await POST(buildRequest({ value: 300, installmentCount: 1 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' });
  });
});
