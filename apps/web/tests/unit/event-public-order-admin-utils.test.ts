import { describe, expect, it } from 'vitest';

import {
  publicOrderAdminStatusDescription,
  isSafePaymentUrl,
  publicOrderAdminStatusLabel,
  publicOrderAdminStatusVariant,
  isPublicOrderPaymentBlocked,
  publicOrderAdminActions,
} from '@/features/events/map/components/public-order-admin-utils';

const order = (overrides: Partial<Parameters<typeof publicOrderAdminStatusLabel>[0]> = {}) => ({
  status: 'PAYMENT_PENDING',
  paymentStatus: 'PENDING',
  asaasPaymentId: 'pay_1',
  ticketFulfillmentStatus: 'PENDING' as const,
  ticketCount: 0,
  seatCount: 2,
  ...overrides,
});

describe('public online order presentation', () => {
  it.each([
    [order(), 'Aguardando'],
    [order({ paymentStatus: 'OVERDUE' }), 'Vencido'],
    [order({ asaasPaymentId: null }), 'Verificando'],
    [order({ paymentStatus: null }), 'Verificando'],
    [order({ paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' }), 'Verificando'],
    [order({ paymentStatus: 'PAYMENT_CREATION_UNKNOWN' }), 'Verificando'],
    [order({ status: 'CONFIRMED', ticketFulfillmentStatus: 'PENDING' }), 'Emitindo'],
    [order({ status: 'CONFIRMED', ticketFulfillmentStatus: 'ISSUED', ticketCount: 2 }), 'Concluído'],
    [order({ status: 'CONFIRMED', ticketFulfillmentStatus: 'FAILED', ticketCount: 1 }), 'Falha na emissão'],
    [order({ status: 'EXPIRED' }), 'Expirado'],
    [order({ status: 'CANCELLED' }), 'Cancelado'],
    [order({ status: 'CONFIRMED', paymentStatus: 'REFUND_REQUESTED' }), 'Estornando'],
    [order({ status: 'CONFIRMED', paymentStatus: 'CHARGEBACK_DISPUTE' }), 'Em disputa'],
    [order({ status: 'CONFIRMED', paymentStatus: 'CHARGEBACK_UNKNOWN' }), 'Em disputa'],
    [order({ status: 'PARTIALLY_REFUNDED' }), 'Estorno parcial'],
    [order({ status: 'REFUNDED' }), 'Estornado'],
  ] as const)('maps %s to a short, explicit status', (value, expected) => {
    expect(publicOrderAdminStatusLabel(value)).toBe(expected);
  });

  it('highlights successful, pending, and failed states with matching tones', () => {
    expect(publicOrderAdminStatusVariant(order({ status: 'CONFIRMED', ticketFulfillmentStatus: 'ISSUED', ticketCount: 2 }))).toBe('success');
    expect(publicOrderAdminStatusVariant(order())).toBe('warning');
    expect(publicOrderAdminStatusVariant(order({ status: 'CONFIRMED', ticketFulfillmentStatus: 'FAILED' }))).toBe('danger');
    expect(publicOrderAdminStatusVariant(order({ paymentStatus: 'PAYMENT_CREATION_UNKNOWN' }))).toBe('warning');
    expect(publicOrderAdminStatusVariant(order({ paymentStatus: 'OVERDUE' }))).toBe('danger');
    expect(publicOrderAdminStatusVariant(order({ status: 'CANCELLED' }))).toBe('neutral');
    expect(publicOrderAdminStatusVariant(order({ status: 'EXPIRED' }))).toBe('neutral');
    expect(publicOrderAdminStatusVariant(order({ status: 'REFUNDED' }))).toBe('info');
  });

  it('explains that uncertain payment creation keeps seats reserved', () => {
    expect(publicOrderAdminStatusDescription(order({ paymentStatus: 'PAYMENT_CREATION_UNKNOWN' })))
      .toContain('não serão liberados');
  });

  it('explains that overdue orders require confirmed cancellation before seats are released', () => {
    expect(publicOrderAdminStatusDescription(order({ paymentStatus: 'OVERDUE' })))
      .toContain('após confirmação');
  });

  it('only exposes secure payment links', () => {
    expect(isSafePaymentUrl('https://www.asaas.com/i/payment')).toBe(true);
    expect(isSafePaymentUrl('http://www.asaas.com/i/payment')).toBe(false);
    expect(isSafePaymentUrl('javascript:alert(1)')).toBe(false);
    expect(isSafePaymentUrl(null)).toBe(false);
  });

  it('blocks ticket delivery and refunds while refund or chargeback is unresolved', () => {
    expect(isPublicOrderPaymentBlocked('PAYMENT_REFUND_IN_PROGRESS')).toBe(true);
    expect(isPublicOrderPaymentBlocked('CHARGEBACK_REQUESTED')).toBe(true);
    expect(isPublicOrderPaymentBlocked('AWAITING_CHARGEBACK_REVERSAL')).toBe(true);
    expect(isPublicOrderPaymentBlocked('CHARGEBACK_UNKNOWN')).toBe(true);
    expect(isPublicOrderPaymentBlocked('REFUND_DENIED')).toBe(false);
    expect(isPublicOrderPaymentBlocked('RECEIVED')).toBe(false);
  });

  it('offers read-only refund details for refunded orders without ticket or refund actions', () => {
    const actions = publicOrderAdminActions({
      status: 'REFUNDED',
      paymentStatus: 'REFUNDED',
      invoiceUrl: 'https://example.com/payment',
      ticketFulfillmentStatus: 'ISSUED',
      ticketCount: 0,
      seatCount: 4,
      ticketsUsed: 0,
    }, true);

    expect(actions).toEqual({
      canCancel: false,
      canViewRefundDetails: true,
      canViewCancellationDetails: false,
      invoiceUrl: null,
      canDownloadTickets: false,
      canRefund: false,
    });
  });

  it('offers read-only cancellation details without payment or mutation actions', () => {
    const actions = publicOrderAdminActions({
      status: 'CANCELLED',
      paymentStatus: 'CANCELLED',
      invoiceUrl: 'https://example.com/payment',
      ticketFulfillmentStatus: 'PENDING',
      ticketCount: 0,
      seatCount: 3,
      ticketsUsed: 0,
    }, true);

    expect(actions).toEqual({
      canCancel: false,
      canViewRefundDetails: false,
      canViewCancellationDetails: true,
      invoiceUrl: null,
      canDownloadTickets: false,
      canRefund: false,
    });
  });

  it('only offers cancellation for a pending order with a linked pending or overdue charge', () => {
    const base = {
      status: 'PAYMENT_PENDING',
      paymentStatus: 'PENDING',
      asaasPaymentId: 'pay_1',
      invoiceUrl: null,
      ticketFulfillmentStatus: 'PENDING' as const,
      ticketCount: 0,
      seatCount: 2,
      ticketsUsed: 0,
    };
    expect(publicOrderAdminActions(base, false).canCancel).toBe(true);
    expect(publicOrderAdminActions({ ...base, paymentStatus: 'OVERDUE' }, false).canCancel).toBe(true);
    expect(publicOrderAdminActions({ ...base, paymentStatus: 'PAYMENT_CREATION_UNKNOWN' }, false).canCancel).toBe(false);
    expect(publicOrderAdminActions({ ...base, paymentStatus: 'RECEIVED' }, false).canCancel).toBe(false);
    expect(publicOrderAdminActions({ ...base, asaasPaymentId: null }, false).canCancel).toBe(false);
  });
});
