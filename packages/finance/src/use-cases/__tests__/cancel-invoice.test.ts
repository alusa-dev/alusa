import { describe, expect, it, vi, beforeEach } from 'vitest';

import { cancelInvoice } from '../cancel-invoice';

vi.mock('@alusa/database', () => ({
  prisma: {
    invoice: { findFirst: vi.fn(), update: vi.fn() },
  },
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  cancelInvoice: vi.fn(),
}));

vi.mock('../../foundation/feature-flags.service', () => ({
  featureFlagsService: { isEnabled: vi.fn() },
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

vi.mock('../../foundation/kyc-guard', () => ({
  requireKycApproved: vi.fn(),
}));

describe('cancelInvoice', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('retorna KYC_NAO_APROVADO quando não aprovado', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { prisma } = await import('@alusa/database');
    const { requireKycApproved } = await import('../../foundation/kyc-guard');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);
    vi.mocked(requireKycApproved).mockResolvedValueOnce({ success: false, error: 'KYC_NAO_APROVADO' } as never);

    const result = await cancelInvoice({
      contaId: 't1',
      invoiceId: 'i1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('KYC_NAO_APROVADO');
    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
  });

  it('cancela invoice no Asaas e atualiza status', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { cancelInvoice: asaasCancelInvoice } = await import('@alusa/asaas');
    const { requireKycApproved } = await import('../../foundation/kyc-guard');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);
    vi.mocked(requireKycApproved).mockResolvedValueOnce({ success: true, data: true } as never);

    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({
      id: 'i1',
      asaasInvoiceId: 'inv_1',
      status: 'REQUESTED',
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x' } as never);

    vi.mocked(asaasCancelInvoice).mockResolvedValueOnce({
      id: 'inv_1',
      status: 'CANCELED',
      pdfUrl: null,
      xmlUrl: null,
      number: null,
    } as never);

    vi.mocked(prisma.invoice.update).mockResolvedValueOnce({
      id: 'i1',
      asaasInvoiceId: 'inv_1',
      status: 'CANCELED',
      statusUpdatedAt: new Date('2026-01-04T00:00:00.000Z'),
    } as never);

    const result = await cancelInvoice({
      contaId: 't1',
      invoiceId: 'i1',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.status).toBe('CANCELED');
  });
});
