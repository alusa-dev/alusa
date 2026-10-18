import { randomUUID } from 'node:crypto';

import { test, expect } from '@playwright/test';
import {
  createCustomer,
  createPayment,
  deleteCustomer,
  deletePayment,
  getCustomer,
  getPayment,
  listCustomers,
  listPayments,
} from '@alusa/asaas';

const sandboxOptIn = process.env.E2E_ASAAS_SANDBOX === 'true';

test.describe('Asaas SDK Sandbox lifecycle', () => {
  test.skip(!sandboxOptIn, 'Defina E2E_ASAAS_SANDBOX=true para habilitar chamadas ao Sandbox Asaas.');

  test('creates, verifies and cleans up a customer and boleto payment', async () => {
    const apiKey = process.env.ASAAS_API_KEY;
    const baseUrl = process.env.ASAAS_BASE_URL;
    const testDatabaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

    if (!apiKey) throw new Error('ASAAS_API_KEY não configurada para o Sandbox.');
    if (!baseUrl) throw new Error('ASAAS_BASE_URL não configurada para o Sandbox.');

    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw new Error('ASAAS_BASE_URL inválida; esperado host Sandbox oficial.');
    }
    if (
      parsedBaseUrl.protocol !== 'https:' ||
      parsedBaseUrl.hostname !== 'api-sandbox.asaas.com' ||
      parsedBaseUrl.username !== '' ||
      parsedBaseUrl.password !== ''
    ) {
      throw new Error(
        'Execução bloqueada: ASAAS_BASE_URL deve usar HTTPS, host api-sandbox.asaas.com e não conter credenciais.',
      );
    }

    if (!testDatabaseUrl) {
      throw new Error('DATABASE_URL_TEST ou DATABASE_URL obrigatória; configure o banco de teste alusa_test.');
    }
    let databaseName: string;
    try {
      const pathname = new URL(testDatabaseUrl).pathname;
      if (pathname !== '/alusa_test') throw new Error('Unexpected database pathname.');
      databaseName = decodeURIComponent(pathname.slice(1));
    } catch {
      throw new Error('URL do banco de teste inválida; esperado pathname exatamente /alusa_test.');
    }
    if (databaseName !== 'alusa_test') {
      throw new Error('Execução bloqueada: DATABASE_URL_TEST deve apontar exatamente para alusa_test.');
    }

    const externalReference = `e2e-asaas-${randomUUID()}`;
    let customerId: string | undefined;
    let paymentId: string | undefined;

    try {
      const customer = await createCustomer({
        apiKey,
        data: {
          name: 'Alusa E2E Sandbox',
          cpfCnpj: '52998224725',
          email: 'asaas-sandbox-e2e@example.test',
          externalReference,
          notificationDisabled: true,
        },
      });
      customerId = customer.id;
      expect(customer.externalReference).toBe(externalReference);

      const customerLookup = await getCustomer({ apiKey, customerId });
      expect(customerLookup.id).toBe(customerId);
      const listedCustomers = await listCustomers({ apiKey, externalReference, limit: 100 });
      expect(listedCustomers.data.some((entry) => entry.id === customerId)).toBe(true);

      const payment = await createPayment({
        apiKey,
        data: {
          customer: customerId,
          billingType: 'BOLETO',
          value: 1,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          description: 'Alusa E2E Sandbox lifecycle',
          externalReference,
        },
      });
      paymentId = payment.id;
      expect(payment.billingType).toBe('BOLETO');
      expect(payment.externalReference).toBe(externalReference);

      const paymentLookup = await getPayment({ apiKey, paymentId });
      expect(paymentLookup.id).toBe(paymentId);
      const listedPayments = await listPayments({ apiKey, customer: customerId, externalReference, limit: 100 });
      expect(listedPayments.data.some((entry) => entry.id === paymentId)).toBe(true);
    } finally {
      try {
        if (paymentId) await deletePayment({ apiKey, paymentId });
      } finally {
        if (customerId) await deleteCustomer({ apiKey, customerId });
      }
    }
  });
});

test.describe('Webhook Asaas', () => {
  test('deve rejeitar webhook sem assinatura sem processar a fila', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/webhooks/asaas`, {
      // O runtime production-like aplica a allowlist de IP antes da assinatura.
      headers: { 'x-forwarded-for': '52.67.12.206' },
      data: {
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_test', value: 100, status: 'RECEIVED' },
      },
    });

    expect(response.status()).toBe(process.env.E2E_SERVER_MODE === 'production' ? 401 : 200);
    const data = await response.json();
    expect(data.error).toBe('Assinatura inválida');
  });
});
