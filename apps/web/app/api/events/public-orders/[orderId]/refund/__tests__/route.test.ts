import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getEventsContextMock, handleEventsRouteErrorMock, getOrderMock, executeRefundMock } = vi.hoisted(() => ({
  getEventsContextMock: vi.fn(),
  handleEventsRouteErrorMock: vi.fn(),
  getOrderMock: vi.fn(),
  executeRefundMock: vi.fn(),
}));

vi.mock('../../../../_helpers', () => ({
  getEventsContext: getEventsContextMock,
  handleEventsRouteError: handleEventsRouteErrorMock,
}));
vi.mock('@/src/server/events/event-route-read.service', () => ({
  getEventOrderRefundContext: getOrderMock,
}));
vi.mock('@/src/server/finance/refund-charge.service', () => ({
  executeCobrancaRefund: executeRefundMock,
}));

import { POST } from '../route';

const routeContext = { params: Promise.resolve({ orderId: 'order-a' }) };

describe('POST /api/events/public-orders/[orderId]/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEventsContextMock.mockResolvedValue({ contaId: 'conta-a', userId: 'user-a', role: 'ADMIN' });
    getOrderMock.mockResolvedValue({ id: 'order-a' });
    executeRefundMock.mockResolvedValue({ status: 202, body: { success: true, pending: true } });
  });

  it('chama o serviço financeiro diretamente com usuário e tenant autenticados', async () => {
    const request = new NextRequest('http://localhost/api/events/public-orders/order-a/refund', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Solicitação do organizador' }),
    });

    const response = await POST(request, routeContext);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ success: true, pending: true });
    expect(executeRefundMock).toHaveBeenCalledWith({
      contaId: 'conta-a',
      userId: 'user-a',
      role: 'ADMIN',
      id: 'event-map-order:order-a',
      body: { description: 'Solicitação do organizador' },
    });
  });

  it('não chama o serviço financeiro quando o pedido não pertence ao tenant', async () => {
    getOrderMock.mockResolvedValueOnce(null);
    const request = new NextRequest('http://localhost/api/events/public-orders/order-a/refund', {
      method: 'POST', body: JSON.stringify({}),
    });

    const response = await POST(request, routeContext);

    expect(response.status).toBe(404);
    expect(executeRefundMock).not.toHaveBeenCalled();
  });

  it('preserva status e corpo de conflito retornados pelo serviço financeiro', async () => {
    executeRefundMock.mockResolvedValueOnce({ status: 409, body: { error: 'Pedido indisponível', code: 'EVENT_ORDER_REFUND_NOT_ELIGIBLE' } });
    const request = new NextRequest('http://localhost/api/events/public-orders/order-a/refund', {
      method: 'POST', body: JSON.stringify({}),
    });

    const response = await POST(request, routeContext);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'EVENT_ORDER_REFUND_NOT_ELIGIBLE' });
  });
});
