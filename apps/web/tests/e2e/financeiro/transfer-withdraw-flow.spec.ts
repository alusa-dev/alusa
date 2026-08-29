import { expect, test } from '@playwright/test';

import { seedAdminAndLogin, prisma } from './helpers/auth';

const TRANSFER_ID = 'tr_e2e_withdraw';

declare global {
  interface Window {
    getRequestedTransferCount?: () => number;
  }
}

test.describe('Financeiro → Conta → saque', () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminAndLogin(page);

    const transferListItems: Array<Record<string, unknown>> = [];
    const requestedPayloads: Array<Record<string, unknown>> = [];

    await page.route('**/api/financeiro/conta?mode=summary**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            balance: { available: 500, syncedAt: '2026-04-09T17:30:00.000Z' },
            financialAccount: {
              status: 'READY',
              canTransfer: true,
              canPixCopyPaste: true,
              reasonCode: null,
            },
            features: {
              manualWithdrawEnabled: true,
              pixTransferEnabled: true,
              bankTransferEnabled: true,
            },
            fees: {
              monthlyTransfersWithoutFee: 1,
              pix: { feeValue: 2, consideredInMonthlyTransfersWithoutFee: true },
              ted: { feeValue: 5, consideredInMonthlyTransfersWithoutFee: false },
            },
            transferContext: {
              tenantDocumentNormalized: '12345678000199',
            },
            statementPreview: {
              summary: { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
              items: [],
            },
            recentTransfers: { items: [], total: 0 },
          },
        }),
      });
    });

    await page.route('**/api/finance/transfers/recipients', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { items: [] } }),
      });
    });

    await page.route('**/api/finance/transfers?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            items: transferListItems,
            total: transferListItems.length,
            page: 1,
            pageSize: 10,
            totalPages: transferListItems.length > 0 ? 1 : 0,
          },
        }),
      });
    });

    await page.route('**/api/finance/transfers/request', async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      requestedPayloads.push(payload);

      expect(payload).toMatchObject({
        amount: '100.00',
        currentPassword: 'senha-segura',
        destination: {
          type: 'PIX',
          pixAddressKey: 'financeiro@alusa.test',
          pixAddressKeyType: 'EMAIL',
        },
      });

      transferListItems.push({
        id: TRANSFER_ID,
        externalReference: `transfer:${TRANSFER_ID}`,
        asaasTransferId: 'asaas_tr_e2e',
        amount: '100.00',
        feeAmount: '0.00',
        netAmount: '100.00',
        status: 'PENDING',
        operation: 'PIX',
        requestedDestinationType: 'PIX_KEY',
        recipientName: 'Fornecedor E2E',
        cpfCnpj: '***.123.456-**',
        bankName: 'Pix',
        description: 'Saque operacional E2E',
        scheduleDate: null,
        transferDate: null,
        createdAt: '2026-04-09T17:30:00.000Z',
        statusUpdatedAt: '2026-04-09T17:31:00.000Z',
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: TRANSFER_ID,
            externalReference: `transfer:${TRANSFER_ID}`,
            status: 'PENDING',
            amount: '100.00',
            createdAt: '2026-04-09T17:30:00.000Z',
          },
        }),
      });
    });

    await page.route(`**/api/finance/transfers/${TRANSFER_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: TRANSFER_ID,
            externalReference: `transfer:${TRANSFER_ID}`,
            asaasTransferId: 'asaas_tr_e2e',
            amount: '100.00',
            feeAmount: '0.00',
            netAmount: '100.00',
            status: 'PENDING',
            operation: 'PIX',
            requestedDestinationType: 'PIX_KEY',
            description: 'Saque operacional E2E',
            scheduleDate: null,
            transferDate: null,
            createdAt: '2026-04-09T17:30:00.000Z',
            statusUpdatedAt: '2026-04-09T17:31:00.000Z',
            transactionReceiptUrl: null,
            endToEndIdentifier: null,
            failReason: null,
            authorized: true,
            canCancel: true,
            lastWebhookAt: null,
            lastReconciledAt: '2026-04-09T17:40:00.000Z',
            timeline: [
              {
                key: 'requested',
                label: 'Solicitação enviada',
                at: '2026-04-09T17:30:00.000Z',
                status: 'DONE',
                detail: 'Solicitação registrada com sucesso.',
              },
              {
                key: 'provider-created',
                label: 'Transferência encaminhada',
                at: '2026-04-09T17:31:00.000Z',
                status: 'DONE',
                detail: 'Transferência enviada para processamento.',
              },
              {
                key: 'webhook',
                label: 'Processamento atualizado',
                at: null,
                status: 'PENDING',
                detail: 'Aguardando atualização do processamento.',
              },
              {
                key: 'reconciled',
                label: 'Dados conferidos',
                at: '2026-04-09T17:40:00.000Z',
                status: 'DONE',
                detail: 'Os dados foram conferidos com o provedor.',
              },
              {
                key: 'current-status',
                label: 'Situação atual',
                at: '2026-04-09T17:31:00.000Z',
                status: 'CURRENT',
                detail: 'A solicitação aguarda processamento.',
              },
            ],
            operationalAlerts: [
              {
                severity: 'warning',
                code: 'WEBHOOK_NAO_RECEBIDO',
                message: 'Ainda não há evento do provedor para esta transferência. A reconciliação deve continuar ativa.',
              },
            ],
            recipient: {
              name: 'Fornecedor E2E',
              cpfCnpj: '***.123.456-**',
              bankName: 'Pix',
              pixKey: 'fi•••@alusa.test',
              agency: null,
              account: null,
              accountDigit: null,
              accountType: null,
            },
          },
        }),
      });
    });

    await page.exposeFunction('getRequestedTransferCount', () => requestedPayloads.length);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('solicita Pix, confirma senha e abre detalhe operacional', async ({ page }) => {
    await page.goto('/financeiro/conta');

    await expect(page.getByRole('heading', { name: 'Saldo' })).toBeVisible();
    await expect(page.getByText('R$ 500,00')).toBeVisible();

    await page.getByRole('button', { name: /transferir/i }).click();
    await expect(page.getByRole('heading', { name: 'Nova transferência' })).toBeVisible();

    await page.getByTestId('wizard-next').click();
    await page.getByLabel('Chave Pix').fill('financeiro@alusa.test');
    await page.getByTestId('wizard-next').click();
    await page.getByLabel('Valor').fill('10000');
    await page.getByTestId('wizard-next').click();
    await page.getByTestId('wizard-next').click();

    await expect(page.getByText('Taxa máxima informada')).toBeVisible();
    await expect(page.getByText('Total máximo estimado')).toBeVisible();
    await expect(page.getByText(/taxa e o valor líquido oficiais retornados/i)).toBeVisible();

    await page.getByTestId('wizard-next').click();
    await expect(page.getByText('Confirmar com senha')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.getRequestedTransferCount?.() ?? 0)).toBe(0);

    await page.getByLabel('Senha atual').fill('senha-segura');
    await page.getByTestId('confirm-transfer-password').click();

    await expect.poll(() => page.evaluate(() => window.getRequestedTransferCount?.() ?? 0)).toBe(1);
    await expect(page.getByText('Fornecedor E2E')).toBeVisible();
    await expect(page.getByText('R$ 0,00')).toBeVisible();

    await page.getByText('Fornecedor E2E').first().click();

    await expect(page).toHaveURL(new RegExp(`/financeiro/conta/transferencias/${TRANSFER_ID}$`));
    await expect(page.getByRole('heading', { name: 'Detalhes da transferência' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Acompanhamento operacional' })).toBeVisible();
    await expect(page.getByText('Solicitação enviada')).toBeVisible();
    await expect(page.getByText('Processamento atualizado')).toBeVisible();
    await expect(page.getByText('Atenção operacional')).toBeVisible();
  });
});
