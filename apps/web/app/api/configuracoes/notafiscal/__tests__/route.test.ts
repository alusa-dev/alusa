import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getChargeInvoiceDetail: vi.fn(),
  ensureChargeInvoiceAutoEmission: vi.fn(),
  ensureChargeInvoiceAutoCancel: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock('@alusa/finance', async () => {
  const actual = await vi.importActual<typeof import('@alusa/finance')>('@alusa/finance');
  return {
    ...actual,
    getChargeInvoiceDetail: mocks.getChargeInvoiceDetail,
    ensureChargeInvoiceAutoEmission: mocks.ensureChargeInvoiceAutoEmission,
    ensureChargeInvoiceAutoCancel: mocks.ensureChargeInvoiceAutoCancel,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/configuracoes/notafiscal', () => {
  it('retorna 401 sem sessão', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/configuracoes/notafiscal/route');
    const res = await GET();

    expect(res.status).toBe(401);
  });
});

describe('GET /api/cobrancas/[id]/nota-fiscal', () => {
  it('retorna 401 sem sessão', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/cobrancas/[id]/nota-fiscal/route');
    const res = await GET({} as never, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('é somente leitura e não dispara emissão nem cancelamento automático', async () => {
    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });
    mocks.getChargeInvoiceDetail.mockResolvedValueOnce({
      success: true,
      data: {
        invoice: null,
        readiness: { ready: false, issues: [] },
        municipalOptions: { supportsCancellation: null },
        eligibility: {
          canEmit: false,
          canRetry: false,
          canCancel: false,
          shouldAutoCancel: false,
          reason: 'NOT_READY',
          message: 'Configure a nota fiscal.',
          severity: 'warning',
        },
        syncPending: false,
      },
    });

    const { GET } = await import('@/app/api/cobrancas/[id]/nota-fiscal/route');
    const res = await GET({} as never, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(mocks.getChargeInvoiceDetail).toHaveBeenCalledWith({
      contaId: 'conta-1',
      routeRef: 'c1',
    });
    expect(mocks.ensureChargeInvoiceAutoEmission).not.toHaveBeenCalled();
    expect(mocks.ensureChargeInvoiceAutoCancel).not.toHaveBeenCalled();
  });

  it('retorna detalhe com prontidão fiscal quando a cobrança existe sem charge vinculada', async () => {
    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });
    mocks.getChargeInvoiceDetail.mockResolvedValueOnce({
      success: true,
      data: {
        invoice: null,
        readiness: { ready: true, issues: [] },
        municipalOptions: { supportsCancellation: true },
        eligibility: {
          canEmit: false,
          canRetry: false,
          canCancel: false,
          shouldAutoCancel: false,
          reason: 'CHARGE_WITHOUT_PAYMENT',
          message: 'Esta cobrança ainda não está vinculada ao emissor de pagamento.',
          severity: 'warning',
        },
        syncPending: false,
      },
    });

    const { GET } = await import('@/app/api/cobrancas/[id]/nota-fiscal/route');
    const res = await GET({} as never, { params: Promise.resolve({ id: 'c1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.readiness.ready).toBe(true);
    expect(mocks.getChargeInvoiceDetail).toHaveBeenCalledWith({
      contaId: 'conta-1',
      routeRef: 'c1',
    });
  });

  it('mapeia CHARGE_NAO_ENCONTRADO do use-case para CHARGE_NAO_ENCONTRADA', async () => {
    mocks.getServerSession.mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });
    mocks.getChargeInvoiceDetail.mockResolvedValueOnce({
      success: false,
      error: 'CHARGE_NAO_ENCONTRADO',
    });

    const { GET } = await import('@/app/api/cobrancas/[id]/nota-fiscal/route');
    const res = await GET({} as never, { params: Promise.resolve({ id: 'c1' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'CHARGE_NAO_ENCONTRADA' });
  });
});
