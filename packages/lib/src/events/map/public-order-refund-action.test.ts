import { describe, expect, it } from 'vitest';

import { isPublicOrderRefundActionPending } from './public-order-refund-action';

describe('isPublicOrderRefundActionPending', () => {
  const boletoOrder = {
    paymentMethod: 'BOLETO',
    status: 'CONFIRMED',
    ticketFulfillmentLastError: null,
  };

  it('mostra a ação de boleto de uma solicitação manual pendente', () => {
    expect(isPublicOrderRefundActionPending({ ...boletoOrder, paymentStatus: 'REFUND_REQUESTED' })).toBe(true);
  });

  it('só mostra a ação de reembolso tardio quando o Asaas aguarda dados do comprador', () => {
    const lateOrder = {
      ...boletoOrder,
      paymentStatus: 'RECEIVED',
      ticketFulfillmentLastError: 'ASSENTOS_INDISPONIVEIS: pedido tardio',
    };
    expect(isPublicOrderRefundActionPending({ ...lateOrder, requestState: 'SUBMITTING' })).toBe(false);
    expect(isPublicOrderRefundActionPending({ ...lateOrder, requestState: 'AWAITING_CUSTOMER_ACTION' })).toBe(true);
    expect(isPublicOrderRefundActionPending({ ...lateOrder, paymentStatus: 'REFUND_DENIED', requestState: 'AWAITING_CUSTOMER_ACTION' })).toBe(false);
  });

  it('esconde a ação após finalização e fora de pedidos de boleto confirmados', () => {
    expect(isPublicOrderRefundActionPending({ ...boletoOrder, paymentStatus: 'REFUNDED' })).toBe(false);
    expect(isPublicOrderRefundActionPending({ ...boletoOrder, status: 'REFUNDED', paymentStatus: 'REFUND_REQUESTED' })).toBe(false);
    expect(isPublicOrderRefundActionPending({ ...boletoOrder, paymentMethod: 'PIX', paymentStatus: 'REFUND_REQUESTED' })).toBe(false);
  });
});
