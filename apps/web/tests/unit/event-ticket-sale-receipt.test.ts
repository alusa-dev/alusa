import { describe, expect, it } from 'vitest';
import {
  buildEventTicketSaleReceiptInput,
  canViewManualEventTicketSaleReceipt,
  isManualEventTicketSaleReceipt,
} from '@/features/events/tickets/event-ticket-sale-receipt';

describe('event-ticket-sale-receipt', () => {
  const baseCobranca = {
    id: 'event-ticket-sale:cmqe6u14w000w483lohasy3y8',
    descricao: null,
    valor: 200,
    vencimento: '2026-06-14T00:00:00.000Z',
    dataPagamento: '2026-06-14T12:30:00.000Z',
    formaPagamento: 'CASH',
    asaasPaymentId: null,
    origin: 'EVENT',
    matricula: {
      aluno: {
        id: 'aluno-1',
        nome: 'Layza Silva',
        cpf: '123.456.789-00',
        email: 'layza@example.com',
        telefone: null,
      },
    },
    eventDetails: {
      eventName: 'Festival de Dança',
      buyerName: 'Layza Silva',
      seats: [
        { seatLabel: 'A9', sectionName: 'Plateia' },
        { seatLabel: 'A10', sectionName: 'Plateia' },
      ],
    },
  };

  it('detects manual event ticket sale receipts', () => {
    expect(isManualEventTicketSaleReceipt(baseCobranca)).toBe(true);
    expect(canViewManualEventTicketSaleReceipt({ ...baseCobranca, status: 'PAGO' })).toBe(true);
    expect(canViewManualEventTicketSaleReceipt({ ...baseCobranca, status: 'ESTORNADO' })).toBe(true);
    expect(canViewManualEventTicketSaleReceipt({ ...baseCobranca, status: 'PENDENTE' })).toBe(false);
    expect(
      isManualEventTicketSaleReceipt({
        ...baseCobranca,
        asaasPaymentId: 'pay_123',
      }),
    ).toBe(false);
    expect(
      isManualEventTicketSaleReceipt({
        ...baseCobranca,
        id: 'event-map-order:order-1',
      }),
    ).toBe(false);
  });

  it('builds paid receipt input without asaas references', () => {
    const { aluno, item } = buildEventTicketSaleReceiptInput({ ...baseCobranca, status: 'PAGO' });

    expect(aluno).toEqual({
      id: 'aluno-1',
      nome: 'Layza Silva',
      cpf: '123.456.789-00',
    });
    expect(item.sourceKind).toBe('event_ticket_sale');
    expect(item.sourceId).toBe('cmqe6u14w000w483lohasy3y8');
    expect(item.chargeType).toBe('EVENT_TICKET');
    expect(item.asaasPaymentId).toBeNull();
    expect(item.pagamento?.asaasPaymentId).toBeNull();
    expect(item.description).toBe('Ingressos - Festival de Dança (Plateia A9, Plateia A10)');
    expect(item.payerName).toBe('Layza Silva');
    expect(item.pagamento?.formaPagamento).toBe('CASH');
    expect(item.pagamento?.valorPago).toBe(200);
    expect(item.pagamento?.status).toBe('PAID');
  });

  it('builds refunded receipt input with refunded payment status', () => {
    const { item } = buildEventTicketSaleReceiptInput({ ...baseCobranca, status: 'ESTORNADO' });

    expect(item.pagamento?.status).toBe('REFUNDED');
    expect(item.asaasPaymentId).toBeNull();
  });
});
