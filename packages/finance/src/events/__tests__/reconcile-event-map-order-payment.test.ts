import { describe, expect, it } from 'vitest';

import {
  reconcileEventMapOrderPayment,
  type ReconcileEventMapOrderPaymentDependencies,
} from '../reconcile-event-map-order-payment';

type TestOrder = {
  id: string;
  contaId: string;
  eventId: string;
  asaasPaymentId: string | null;
  paymentMethod: string | null;
};

function createDependencies(params: {
  order: TestOrder | null;
  paymentBillingType?: string | null;
  credentials?: { apiKey?: string | null } | null;
  asaasError?: Error;
}) {
  let order = params.order;
  const calls = {
    getPayment: 0,
    updateOrderPaymentMethod: 0,
    recordAudit: 0,
  };

  const dependencies: ReconcileEventMapOrderPaymentDependencies = {
    findOrder: async (input) => {
      if (!order) return null;
      if (order.id !== input.orderId) return null;
      if (order.contaId !== input.contaId) return null;
      if (order.eventId !== input.eventId) return null;
      return order;
    },
    loadCredentials: async () => params.credentials ?? { apiKey: 'asaas-key' },
    getPayment: async () => {
      calls.getPayment += 1;
      if (params.asaasError) throw params.asaasError;
      return { billingType: params.paymentBillingType ?? 'PIX' };
    },
    updateOrderPaymentMethod: async (update) => {
      calls.updateOrderPaymentMethod += 1;
      if (!order) throw new Error('Order not found in test dependencies.');
      order = {
        ...order,
        paymentMethod: update.paymentMethod,
      };
      return order;
    },
    recordAudit: async () => {
      calls.recordAudit += 1;
    },
  };

  return {
    calls,
    dependencies,
    getOrder: () => order,
  };
}

const baseInput = {
  contaId: 'conta-1',
  userId: 'user-1',
  eventId: 'event-1',
  orderId: 'order-1',
};

describe('reconcileEventMapOrderPayment', () => {
  it('does not call Asaas when the order has no asaasPaymentId', async () => {
    const setup = createDependencies({
      order: {
        id: 'order-1',
        contaId: 'conta-1',
        eventId: 'event-1',
        asaasPaymentId: null,
        paymentMethod: null,
      },
    });

    await expect(reconcileEventMapOrderPayment(baseInput, setup.dependencies)).resolves.toMatchObject({
      ok: true,
      updated: false,
      asaasPaymentId: null,
    });
    expect(setup.calls.getPayment).toBe(0);
    expect(setup.calls.updateOrderPaymentMethod).toBe(0);
  });

  it('does not update when the payment method is already filled', async () => {
    const setup = createDependencies({
      order: {
        id: 'order-1',
        contaId: 'conta-1',
        eventId: 'event-1',
        asaasPaymentId: 'pay-1',
        paymentMethod: 'PIX',
      },
    });

    await expect(reconcileEventMapOrderPayment(baseInput, setup.dependencies)).resolves.toMatchObject({
      ok: true,
      updated: false,
      paymentMethod: 'PIX',
    });
    expect(setup.calls.getPayment).toBe(0);
    expect(setup.calls.updateOrderPaymentMethod).toBe(0);
  });

  it('loads Asaas payment and stores billingType when paymentMethod is missing', async () => {
    const setup = createDependencies({
      order: {
        id: 'order-1',
        contaId: 'conta-1',
        eventId: 'event-1',
        asaasPaymentId: 'pay-1',
        paymentMethod: null,
      },
      paymentBillingType: 'BOLETO',
    });

    await expect(reconcileEventMapOrderPayment(baseInput, setup.dependencies)).resolves.toMatchObject({
      ok: true,
      updated: true,
      previousPaymentMethod: null,
      paymentMethod: 'BOLETO',
    });
    expect(setup.calls.getPayment).toBe(1);
    expect(setup.calls.updateOrderPaymentMethod).toBe(1);
    expect(setup.calls.recordAudit).toBe(1);
    expect(setup.getOrder()?.paymentMethod).toBe('BOLETO');
  });

  it('does not find an order from another conta', async () => {
    const setup = createDependencies({
      order: {
        id: 'order-1',
        contaId: 'conta-2',
        eventId: 'event-1',
        asaasPaymentId: 'pay-1',
        paymentMethod: null,
      },
    });

    await expect(reconcileEventMapOrderPayment(baseInput, setup.dependencies)).rejects.toMatchObject({
      code: 'PEDIDO_NAO_ENCONTRADO',
    });
    expect(setup.calls.getPayment).toBe(0);
  });

  it('does not find an order from another event', async () => {
    const setup = createDependencies({
      order: {
        id: 'order-1',
        contaId: 'conta-1',
        eventId: 'event-2',
        asaasPaymentId: 'pay-1',
        paymentMethod: null,
      },
    });

    await expect(reconcileEventMapOrderPayment(baseInput, setup.dependencies)).rejects.toMatchObject({
      code: 'PEDIDO_NAO_ENCONTRADO',
    });
    expect(setup.calls.getPayment).toBe(0);
  });

  it('throws controlled error and does not update on Asaas failure', async () => {
    const setup = createDependencies({
      order: {
        id: 'order-1',
        contaId: 'conta-1',
        eventId: 'event-1',
        asaasPaymentId: 'pay-1',
        paymentMethod: null,
      },
      asaasError: new Error('network failure'),
    });

    await expect(reconcileEventMapOrderPayment(baseInput, setup.dependencies)).rejects.toMatchObject({
      code: 'ASAAS_PAYMENT_RECONCILE_FAILED',
    });
    expect(setup.calls.getPayment).toBe(1);
    expect(setup.calls.updateOrderPaymentMethod).toBe(0);
    expect(setup.calls.recordAudit).toBe(0);
    expect(setup.getOrder()?.paymentMethod).toBeNull();
  });
});
