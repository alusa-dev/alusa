import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  invoice: {
    findFirst: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  charge: {
    findFirst: vi.fn(),
  },
  contaFiscalSettings: {},
  fiscalService: {},
  invoiceAuditEvent: { create: vi.fn() },
}));

vi.mock('@alusa/database', () => ({
  prisma: prismaMock,
}));

vi.mock('../../fiscal/fiscal-prisma', () => ({
  getFiscalPrisma: () => prismaMock,
}));

import { prisma } from '@alusa/database';
import { handleInvoiceWebhook } from '../invoice-webhook-handler';

describe('handleInvoiceWebhook', () => {
  beforeEach(() => vi.resetAllMocks());

  it('atualiza status monotonicamente', async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce({
      id: 'inv1',
      contaId: 't1',
      status: 'SCHEDULED',
      asaasInvoiceId: 'asaas-inv-1',
    } as never);

    vi.mocked(prisma.invoice.update).mockResolvedValueOnce({
      id: 'inv1',
      status: 'AUTHORIZED',
    } as never);

    const result = await handleInvoiceWebhook('t1', {
      event: 'INVOICE_AUTHORIZED',
      id: 'evt-1',
      invoice: { id: 'asaas-inv-1', status: 'AUTHORIZED', number: '123' },
    });

    expect(result.handled).toBe(true);
    expect(result.nextStatus).toBe('AUTHORIZED');
    expect(prisma.invoice.update).toHaveBeenCalled();
  });

  it('ignora invoice de outro tenant (não encontrada)', async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);

    const result = await handleInvoiceWebhook('t2', {
      event: 'INVOICE_CREATED',
      invoice: { id: 'asaas-inv-x' },
    });

    expect(result.skipped).toBe(true);
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it('cria invoice local quando webhook do Asaas chega sem registro prévio', async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'charge-1',
      cobrancaId: 'cobranca-1',
      cobranca: {
        matriculaId: 'matricula-1',
        matricula: { responsavelFinanceiroId: 'resp-1' },
      },
    } as never);
    vi.mocked(prisma.invoice.upsert).mockResolvedValueOnce({
      id: 'charge-1',
      status: 'AUTHORIZED',
    } as never);

    const result = await handleInvoiceWebhook('t1', {
      event: 'INVOICE_AUTHORIZED',
      id: 'evt-2',
      invoice: {
        id: 'asaas-inv-2',
        status: 'AUTHORIZED',
        payment: 'pay-1',
        number: '433407',
        pdfUrl: 'https://asaas.test/nfse.pdf',
      },
    });

    expect(result.handled).toBe(true);
    expect(result.nextStatus).toBe('AUTHORIZED');
    expect(prisma.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chargeId: 'charge-1' },
      }),
    );
    expect(prisma.invoiceAuditEvent.create).toHaveBeenCalled();
  });
});
