/**
 * Testes E2E para fluxo de integração com Asaas
 *
 * Valida criação de customers, payments e webhooks
 */

import { test, expect } from '@playwright/test';

test.describe('Integração Asaas', () => {
  test.skip(process.env.FEATURE_ASAAS !== 'true', 'Feature Asaas desabilitada');

  let customerId: string;

  test.beforeAll(async () => {
    // Verificar se variáveis de ambiente estão configuradas
    if (!process.env.ASAAS_API_KEY) {
      throw new Error('ASAAS_API_KEY não configurada');
    }
  });

  test('deve criar customer via API', async ({ request }) => {
    const response = await request.post('http://localhost:3001/api/asaas/customers', {
      data: {
        customData: {
          name: 'E2E Test Customer',
          cpfCnpj: '12345678909',
          email: 'e2e@test.com',
          phone: '11999999999',
        },
      },
    });

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.customer).toBeDefined();
    expect(data.customer.name).toBe('E2E Test Customer');

    customerId = data.customer.id;
  });

  test('deve buscar customer criado', async ({ request }) => {
    test.skip(!customerId, 'Customer não foi criado');

    const response = await request.get(`http://localhost:3001/api/asaas/customers/${customerId}`);

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.customer.id).toBe(customerId);
  });

  test('deve criar payment para customer', async ({ request }) => {
    test.skip(!customerId, 'Customer não foi criado');

    const response = await request.post('http://localhost:3001/api/asaas/payments', {
      data: {
        customData: {
          customer: customerId,
          billingType: 'BOLETO',
          value: 199.9,
          dueDate: '2025-10-15',
          description: 'Pagamento E2E Test',
        },
      },
    });

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.payment).toBeDefined();
    expect(data.payment.value).toBe(199.9);
  });

  test('deve listar payments do customer', async ({ request }) => {
    test.skip(!customerId, 'Customer não foi criado');

    const response = await request.get(
      `http://localhost:3001/api/asaas/payments?customer=${customerId}`,
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data)).toBe(true);
  });

  test.skip('deve deletar customer', async ({ request }) => {
    // SKIP: Só deletar se não houver assinaturas ativas
    // Implementar lógica de cleanup após todos os testes
    test.skip(!customerId, 'Customer não foi criado');

    const response = await request.delete(
      `http://localhost:3001/api/asaas/customers/${customerId}`,
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
  });
});

test.describe('Webhook Asaas', () => {
  test.skip(process.env.FEATURE_ASAAS !== 'true', 'Feature Asaas desabilitada');

  test('deve ignorar webhook sem assinatura sem penalizar a fila', async ({ request }) => {
    const response = await request.post('http://localhost:3001/api/webhooks/asaas', {
      data: {
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: 'pay_test',
          value: 100,
          status: 'RECEIVED',
        },
      },
    });

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.error).toBe('Assinatura inválida');
  });

  // TODO: Adicionar teste com assinatura válida (requer calcular HMAC-SHA256)
});
