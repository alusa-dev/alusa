/**
 * Testes E2E para fluxo de integração com Asaas
 *
 * Valida criação de customers, payments e webhooks
 */

import { test, expect } from '@playwright/test';

const hasSandboxCredentials =
  Boolean(process.env.ASAAS_API_KEY) &&
  (process.env.ASAAS_BASE_URL ?? '').includes('sandbox.asaas.com');
const runLegacySandboxApiSuite = process.env.E2E_ASAAS_LEGACY_API === 'true';

test.describe('Integração Asaas', () => {
  test.skip(
    !hasSandboxCredentials || !runLegacySandboxApiSuite,
    'A suíte legada de API Asaas requer sandbox explícito e E2E_ASAAS_LEGACY_API=true',
  );

  let customerId: string;

  test.beforeAll(async () => {
    // Verificar se variáveis de ambiente estão configuradas
    if (!process.env.ASAAS_API_KEY) {
      throw new Error('ASAAS_API_KEY não configurada');
    }
  });

  test('deve criar customer via API', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/asaas/customers`, {
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

  test('deve buscar customer criado', async ({ request, baseURL }) => {
    test.skip(!customerId, 'Customer não foi criado');

    const response = await request.get(`${baseURL}/api/asaas/customers/${customerId}`);

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.customer.id).toBe(customerId);
  });

  test('deve criar payment para customer', async ({ request, baseURL }) => {
    test.skip(!customerId, 'Customer não foi criado');

    const response = await request.post(`${baseURL}/api/asaas/payments`, {
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

  test('deve listar payments do customer', async ({ request, baseURL }) => {
    test.skip(!customerId, 'Customer não foi criado');

    const response = await request.get(
      `${baseURL}/api/asaas/payments?customer=${customerId}`,
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data)).toBe(true);
  });

  test.skip('deve deletar customer', async ({ request, baseURL }) => {
    // SKIP: Só deletar se não houver assinaturas ativas
    // Implementar lógica de cleanup após todos os testes
    test.skip(!customerId, 'Customer não foi criado');

    const response = await request.delete(
      `${baseURL}/api/asaas/customers/${customerId}`,
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
  });
});

test.describe('Webhook Asaas', () => {
  test('deve rejeitar webhook sem assinatura sem processar a fila', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/webhooks/asaas`, {
      // O runtime production-like aplica a allowlist de IP antes da
      // assinatura. Simula uma origem oficial para testar a rejeição de auth.
      headers: { 'x-forwarded-for': '52.67.12.206' },
      data: {
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: 'pay_test',
          value: 100,
          status: 'RECEIVED',
        },
      },
    });

    // O runtime production-like usa rejeições HTTP estritas; em dev a rota
    // mantém 200 para evitar retries do provedor durante testes locais.
    expect(response.status()).toBe(process.env.E2E_SERVER_MODE === 'production' ? 401 : 200);

    const data = await response.json();
    expect(data.error).toBe('Assinatura inválida');
  });

  // TODO: Adicionar teste com assinatura válida (requer calcular HMAC-SHA256)
});
