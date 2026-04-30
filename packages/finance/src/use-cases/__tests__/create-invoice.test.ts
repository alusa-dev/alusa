import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createInvoice } from '../create-invoice';

vi.mock('@alusa/database', () => ({
  prisma: {
    charge: { findFirst: vi.fn() },
    invoice: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  },
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  createInvoice: vi.fn(),
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

describe('createInvoice', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('retorna KYC_NAO_APROVADO quando não aprovado', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { prisma } = await import('@alusa/database');
    const { requireKycApproved } = await import('../../foundation/kyc-guard');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);
    vi.mocked(requireKycApproved).mockResolvedValueOnce({ success: false, error: 'KYC_NAO_APROVADO' } as never);

    const result = await createInvoice({
      contaId: 't1',
      chargeId: 'c1',
      serviceDescription: 'S',
      observations: 'O',
      value: 100,
      deductions: 0,
      effectiveDate: '2026-01-04',
      municipalServiceName: 'Serviço',
      taxes: { retainIss: false, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0, iss: 0 },
      actor: { type: 'USER', id: 'u1' },
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('KYC_NAO_APROVADO');
    expect(prisma.charge.findFirst).not.toHaveBeenCalled();
  });

  it('retorna FEATURE_DISABLED quando flag está off', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { requireKycApproved } = await import('../../foundation/kyc-guard');
    vi.mocked(requireKycApproved).mockResolvedValueOnce({ success: true, data: true } as never);
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(false);

    const result = await createInvoice({
      contaId: 't1',
      chargeId: 'c1',
      serviceDescription: 'S',
      observations: 'O',
      value: 100,
      deductions: 0,
      effectiveDate: '2026-01-04',
      municipalServiceName: 'Serviço',
      taxes: { retainIss: false, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0, iss: 0 },
      actor: { type: 'USER', id: 'u1' },
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('FEATURE_DISABLED');
  });

  it('cria invoice no Asaas e persiste no banco', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createInvoice: asaasCreateInvoice } = await import('@alusa/asaas');
    const { requireKycApproved } = await import('../../foundation/kyc-guard');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);
    vi.mocked(requireKycApproved).mockResolvedValueOnce({ success: true, data: true } as never);

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({ id: 'c1', asaasPaymentId: 'pay_1' } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.invoice.upsert).mockResolvedValueOnce({ id: 'c1' } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x' } as never);

    vi.mocked(asaasCreateInvoice).mockResolvedValueOnce({
      id: 'inv_1',
      status: 'SCHEDULED',
      pdfUrl: null,
      xmlUrl: null,
      number: null,
    } as never);

    vi.mocked(prisma.invoice.update).mockResolvedValueOnce({
      id: 'c1',
      chargeId: 'c1',
      externalReference: 'invoice:c1',
      asaasInvoiceId: 'inv_1',
      status: 'REQUESTED',
      statusUpdatedAt: new Date('2026-01-04T00:00:00.000Z'),
      pdfUrl: null,
      xmlUrl: null,
      number: null,
      createdAt: new Date('2026-01-04T00:00:00.000Z'),
    } as never);

    const result = await createInvoice({
      contaId: 't1',
      chargeId: 'c1',
      serviceDescription: 'S',
      observations: 'O',
      value: 100,
      deductions: 0,
      effectiveDate: '2026-01-04',
      municipalServiceName: 'Serviço',
      municipalServiceCode: '1.01',
      taxes: { retainIss: false, cofins: 0, csll: 0, inss: 0, ir: 0, pis: 0, iss: 0 },
      actor: { type: 'USER', id: 'u1' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.asaasInvoiceId).toBe('inv_1');
    expect(asaasCreateInvoice).toHaveBeenCalled();
  });
});
