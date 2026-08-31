import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  prisma: {
    eventFinancialEntry: { findFirst: vi.fn() },
    eventParticipant: { findFirst: vi.fn() },
    charge: { findMany: vi.fn() },
    standaloneInstallmentPlan: { findMany: vi.fn() },
    eventTicketSale: { findFirst: vi.fn() },
    eventMapOrder: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@alusa/database';
import {
  mapOperationalStatusToCobrancaDisplay,
  parseOperationalChargeId,
  resolveOperationalChargePayment,
} from '../resolve-operational-charge-payment';

describe('resolve-operational-charge-payment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parseia ids operacionais de evento', () => {
    expect(parseOperationalChargeId('event-entry:entry_1')).toEqual({
      kind: 'event-entry',
      entityId: 'entry_1',
    });
    expect(parseOperationalChargeId('event-ticket-sale:sale_1')).toEqual({
      kind: 'event-ticket-sale',
      entityId: 'sale_1',
    });
    expect(parseOperationalChargeId('event-map-order:order_1')).toEqual({
      kind: 'event-map-order',
      entityId: 'order_1',
    });
    expect(parseOperationalChargeId('ch_abc')).toBeNull();
  });

  it('resolve lançamento legado de grupo para a parcela real do Asaas', async () => {
    const dueDate = new Date('2026-09-01T00:00:00.000Z');
    vi.mocked(prisma.eventFinancialEntry.findFirst).mockResolvedValue({
      id: 'entry_group_1',
      eventId: 'event-1',
      status: 'PENDING',
      expectedAmount: 702,
      actualAmount: null,
      paymentProvider: 'ASAAS',
      asaasPaymentId: null,
      description: 'Taxa da cobrança agrupada do evento',
      category: 'Taxa de inscrição',
      dueDate,
      realizedAt: null,
      refundedAmount: 0,
      proofUrl: null,
      paymentMethod: null,
      event: { id: 'event-1', name: 'Festival' },
    } as never);
    vi.mocked(prisma.eventParticipant.findFirst).mockResolvedValue({
      displayName: 'Aluno',
      aluno: { nome: 'Aluno' },
      responsavel: { nome: 'Responsável' },
      standaloneChargeId: 'plan-1',
      asaasPaymentId: null,
      asaasInstallmentId: 'installment-1',
      billingGroup: {
        standaloneChargeId: 'plan-1',
        asaasPaymentId: null,
        asaasInstallmentId: 'installment-1',
      },
    } as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValue([
      {
        id: 'charge-1',
        status: 'OPEN',
        asaasPaymentId: 'pay-1',
        invoiceUrl: 'https://asaas.example/invoice',
        billingType: 'CREDIT_CARD',
        value: 1053,
        dueDate,
        payerName: 'Responsável',
        description: 'Parcela 1 de 2',
        statusUpdatedAt: dueDate,
      },
    ] as never);
    vi.mocked(prisma.standaloneInstallmentPlan.findMany).mockResolvedValue([]);

    const resolved = await resolveOperationalChargePayment('conta-1', 'event-entry:entry_group_1');

    expect(resolved).toMatchObject({
      asaasPaymentId: 'pay-1',
      invoiceUrl: 'https://asaas.example/invoice',
      billingType: 'CREDIT_CARD',
      value: 1053,
      payerName: 'Responsável',
      localStatus: 'PENDING',
    });
  });

  it('resolve venda de ingresso tenant-scoped', async () => {
    vi.mocked(prisma.eventTicketSale.findFirst).mockResolvedValue({
      id: 'sale_1',
      contaId: 'conta-1',
      eventId: 'event-1',
      buyerName: 'Bryan de Alencar Bezerra',
      alunoId: 'aluno-1',
      quantity: 2,
      totalAmount: 650,
      paymentMethod: 'PIX',
      status: 'PENDING',
      soldAt: new Date('2026-09-03T12:00:00.000Z'),
      paidAt: null,
      asaasPaymentId: 'pay_123',
      refundedAmount: 0,
      event: { id: 'event-1', name: '5º Festival de Dança' },
      saleSeats: [
        {
          id: 'sale-seat-1',
          sectionName: 'Plateia',
          seatLabel: 'A10',
          unitPriceSnapshot: 325,
        },
      ],
    } as never);

    const resolved = await resolveOperationalChargePayment('conta-1', 'event-ticket-sale:sale_1');

    expect(resolved).toMatchObject({
      operationalId: 'event-ticket-sale:sale_1',
      kind: 'event-ticket-sale',
      eventId: 'event-1',
      payerName: 'Bryan de Alencar Bezerra',
      asaasPaymentId: 'pay_123',
      localStatus: 'PENDING',
      value: 650,
      eventDetails: {
        eventName: '5º Festival de Dança',
        buyerName: 'Bryan de Alencar Bezerra',
        ticketsUrl: null,
      },
    });
    expect(resolved?.eventDetails?.seats).toEqual([
      { id: 'sale-seat-1', sectionName: 'Plateia', seatLabel: 'A10', unitPrice: 325 },
    ]);
    expect(mapOperationalStatusToCobrancaDisplay(resolved!.localStatus)).toBe('PENDENTE');
  });

  it('expõe ingressos apenas para venda manual paga com assentos', async () => {
    vi.mocked(prisma.eventTicketSale.findFirst).mockResolvedValue({
      id: 'sale_paid',
      contaId: 'conta-1',
      eventId: 'event-1',
      buyerName: 'Layza Silva',
      alunoId: 'aluno-1',
      quantity: 4,
      totalAmount: 200,
      paymentMethod: 'CASH',
      status: 'PAID',
      soldAt: new Date('2026-06-02T12:00:00.000Z'),
      paidAt: new Date('2026-06-02T12:00:00.000Z'),
      asaasPaymentId: null,
      refundedAmount: 0,
      event: { id: 'event-1', name: 'Festival' },
      saleSeats: [{ id: 'seat-1', sectionName: 'Plateia', seatLabel: 'A9', unitPriceSnapshot: 50 }],
    } as never);

    const resolved = await resolveOperationalChargePayment('conta-1', 'event-ticket-sale:sale_paid');

    expect(resolved?.eventDetails?.ticketsUrl).toBe('/api/events/ticket-sales/sale_paid/tickets');
  });

  it('oculta ingressos para venda manual estornada', async () => {
    vi.mocked(prisma.eventTicketSale.findFirst).mockResolvedValue({
      id: 'sale_refunded',
      contaId: 'conta-1',
      eventId: 'event-1',
      buyerName: 'Layza Silva',
      alunoId: 'aluno-1',
      quantity: 4,
      totalAmount: 200,
      paymentMethod: 'CASH',
      status: 'REFUNDED',
      soldAt: new Date('2026-06-02T12:00:00.000Z'),
      paidAt: new Date('2026-06-02T12:00:00.000Z'),
      asaasPaymentId: null,
      refundedAmount: 200,
      event: { id: 'event-1', name: 'Festival' },
      saleSeats: [{ id: 'seat-1', sectionName: 'Plateia', seatLabel: 'A9', unitPriceSnapshot: 50 }],
    } as never);

    const resolved = await resolveOperationalChargePayment('conta-1', 'event-ticket-sale:sale_refunded');

    expect(resolved?.localStatus).toBe('REFUNDED');
    expect(resolved?.eventDetails?.ticketsUrl).toBeNull();
  });

  it('marca pedido de mapa como atrasado quando expiresAt passou', async () => {
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValue({
      id: 'order_1',
      contaId: 'conta-1',
      eventId: 'event-1',
      buyerName: 'Comprador',
      totalAmount: 300,
      status: 'PAYMENT_PENDING',
      paymentMethod: 'PIX',
      paymentProvider: null,
      asaasPaymentId: 'pay_map',
      paymentStatus: null,
      invoiceUrl: 'https://invoice.example',
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      paidAt: null,
      refundedAmount: 0,
      event: { id: 'event-1', name: 'Evento' },
      items: [
        {
          id: 'item-1',
          sectionName: 'Mezanino',
          seatLabel: 'B2',
          unitPriceSnapshot: 300,
        },
      ],
    } as never);

    const resolved = await resolveOperationalChargePayment('conta-1', 'event-map-order:order_1');

    expect(resolved?.localStatus).toBe('OVERDUE');
    expect(resolved?.eventDetails).toMatchObject({
      eventName: 'Evento',
      buyerName: 'Comprador',
      ticketsUrl: null,
    });
    expect(resolved?.eventDetails?.seats).toEqual([
      { id: 'item-1', sectionName: 'Mezanino', seatLabel: 'B2', unitPrice: 300 },
    ]);
    expect(mapOperationalStatusToCobrancaDisplay(resolved!.localStatus)).toBe('ATRASADO');
  });

  it('mantém pedido público em processamento durante estorno Asaas sem marcar como estornado final', async () => {
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValue({
      id: 'order_refund',
      contaId: 'conta-1',
      eventId: 'event-1',
      buyerName: 'Comprador',
      totalAmount: 300,
      status: 'CONFIRMED',
      paymentMethod: 'PIX',
      paymentProvider: null,
      asaasPaymentId: 'pay_map',
      paymentStatus: 'REFUND_IN_PROGRESS',
      invoiceUrl: 'https://invoice.example',
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      paidAt: new Date('2026-06-01T00:05:00.000Z'),
      refundedAmount: 0,
      event: { id: 'event-1', name: 'Evento' },
      items: [],
    } as never);

    const resolved = await resolveOperationalChargePayment('conta-1', 'event-map-order:order_refund');

    expect(resolved?.localStatus).toBe('PROCESSING');
    expect(mapOperationalStatusToCobrancaDisplay(resolved!.localStatus)).toBe('PROCESSANDO');
  });
});
