import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveChargeFromRouteRef: vi.fn(),
  getFiscalInvoiceSettings: vi.fn(),
  resolveChargeInvoiceContext: vi.fn(),
  ensureAcademicChargeForCobranca: vi.fn(),
  ensureChargeInvoiceAutoEmission: vi.fn(),
  chargeFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  fiscalServiceFindFirst: vi.fn(),
  cobrancaFindFirst: vi.fn(),
}));

vi.mock('../../fiscal/resolve-charge-route-ref', () => ({
  resolveChargeFromRouteRef: mocks.resolveChargeFromRouteRef,
}));

vi.mock('../get-fiscal-invoice-settings', () => ({
  getFiscalInvoiceSettings: mocks.getFiscalInvoiceSettings,
}));

vi.mock('../../fiscal/charge-invoice-context', () => ({
  resolveChargeInvoiceContext: mocks.resolveChargeInvoiceContext,
  buildChargeInvoiceTexts: vi.fn(),
}));

vi.mock('../../fiscal/ensure-academic-charge-for-cobranca', () => ({
  ensureAcademicChargeForCobranca: mocks.ensureAcademicChargeForCobranca,
}));

vi.mock('../ensure-charge-invoice-auto-emission', () => ({
  ensureChargeInvoiceAutoEmission: mocks.ensureChargeInvoiceAutoEmission,
}));

vi.mock('../../fiscal/fiscal-prisma', () => ({
  getFiscalPrisma: () => ({
    charge: { findFirst: mocks.chargeFindFirst },
    invoice: { findFirst: mocks.invoiceFindFirst },
    fiscalService: { findFirst: mocks.fiscalServiceFindFirst },
    cobranca: { findFirst: mocks.cobrancaFindFirst },
  }),
}));

import { getChargeInvoiceDetail } from '../get-charge-invoice-detail';

const readySettings = {
  success: true as const,
  data: {
    readiness: { status: 'READY', ready: true, issues: [] },
    municipalOptions: { supportsCancellation: true },
    settings: null,
  },
};

describe('getChargeInvoiceDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFiscalInvoiceSettings.mockResolvedValue(readySettings);
  });

  it('materializa charge e tenta auto emissão quando cobrança tem pagamento Asaas', async () => {
    mocks.resolveChargeFromRouteRef
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ chargeId: 'charge-1', cobrancaId: 'cobranca-1' });
    mocks.cobrancaFindFirst.mockResolvedValueOnce({
      id: 'cobranca-1',
      status: 'PAGO',
      valor: 500,
      valorFinal: null,
      asaasPaymentId: 'pay_123',
      asaasStatus: 'CONFIRMED',
    });
    mocks.ensureAcademicChargeForCobranca.mockResolvedValueOnce({
      chargeId: 'charge-1',
      created: true,
    });
    mocks.ensureChargeInvoiceAutoEmission.mockResolvedValueOnce(undefined);
    mocks.invoiceFindFirst.mockResolvedValueOnce(null);
    mocks.resolveChargeInvoiceContext.mockResolvedValueOnce({
      charge: {
        status: 'PAID',
        asaasStatus: 'CONFIRMED',
        asaasPaymentId: 'pay_123',
        cobranca: { status: 'PAGO', valor: 500, valorFinal: null },
      },
      value: 500,
      effectiveDate: '2026-06-17',
      context: {},
    });

    const result = await getChargeInvoiceDetail({ contaId: 'conta-1', routeRef: 'cobranca-1' });

    expect(mocks.ensureAcademicChargeForCobranca).toHaveBeenCalled();
    expect(mocks.ensureChargeInvoiceAutoEmission).toHaveBeenCalledWith({
      contaId: 'conta-1',
      chargeId: 'charge-1',
    });
    expect(result.success).toBe(true);
  });

  it('retorna prontidão fiscal real quando cobrança existe sem pagamento Asaas', async () => {
    mocks.resolveChargeFromRouteRef.mockResolvedValueOnce(null);
    mocks.cobrancaFindFirst.mockResolvedValueOnce({
      status: 'PENDENTE',
      valor: 500,
      valorFinal: null,
      asaasPaymentId: null,
      asaasStatus: null,
    });

    const result = await getChargeInvoiceDetail({ contaId: 'conta-1', routeRef: 'cobranca-1' });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.invoice).toBeNull();
    expect(result.data.readiness.ready).toBe(true);
    expect(result.data.eligibility.reason).toBe('CHARGE_WITHOUT_PAYMENT');
    expect(mocks.getFiscalInvoiceSettings).toHaveBeenCalledWith({
      contaId: 'conta-1',
      remoteSync: 'if_stale',
    });
    expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
  });

  it('retorna CHARGE_NAO_ENCONTRADO quando nem charge nem cobrança existem', async () => {
    mocks.resolveChargeFromRouteRef.mockResolvedValueOnce(null);
    mocks.cobrancaFindFirst.mockResolvedValueOnce(null);

    const result = await getChargeInvoiceDetail({ contaId: 'conta-1', routeRef: 'missing' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('CHARGE_NAO_ENCONTRADO');
  });
});
