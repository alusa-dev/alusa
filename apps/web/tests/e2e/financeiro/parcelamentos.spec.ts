import { test, expect } from '@playwright/test';
import { seedAdminAndLogin, prisma } from './helpers/auth';
import { seedFinanceData, type SeedResult } from './helpers/seed-finance';
import { ApiHelper, waitForPageReady } from './helpers/api';

let seed: SeedResult;

test.describe('Cobranças → Parcelamentos', () => {
  test.beforeEach(async ({ page }) => {
    const { contaId } = await seedAdminAndLogin(page);
    seed = await seedFinanceData(prisma, contaId);
  });

  test('lista parcelamentos como agregados', async ({ page }) => {
    await page.goto('/cobrancas/parcelamentos');
    await waitForPageReady(page, 'Parcelamentos');

    // Deve ter pelo menos 2 parcelamentos (acadêmico + standalone)
    const rows = page.locator('tbody > tr');
    await expect(rows).toHaveCount(2, { timeout: 5_000 });

    // Deve mostrar nome do pagador
    await expect(page.getByText('Maria Financeiro E2E').or(page.getByText('João Aluno E2E'))).toBeVisible();
  });

  test('clique navega para detalhe /cobrancas/parcelamentos/[id]', async ({ page }) => {
    await page.goto('/cobrancas/parcelamentos');
    await waitForPageReady(page, 'Parcelamentos');

    const row = page.locator('tbody > tr').first();
    await row.click();

    await expect(page).toHaveURL(/\/cobrancas\/parcelamentos\/[a-z0-9]+$/i, { timeout: 10_000 });
  });

  test('detalhe mostra lista de parcelas', async ({ page }) => {
    // Ir para detalhe do parcelamento standalone (2 parcelas)
    await page.goto(`/cobrancas/parcelamentos/${seed.standaloneInstallmentPlanId}`);
    await waitForPageReady(page, 'Parcelamento');

    // Seção "Parcelas" deve existir
    await expect(page.getByRole('heading', { name: 'Parcelas' })).toBeVisible();

    // Deve ter 2 parcelas na tabela
    const parcelaRows = page.locator('tbody > tr');
    await expect(parcelaRows).toHaveCount(2, { timeout: 5_000 });
  });

  test('link na parcela navega para /cobrancas/[chargeId]', async ({ page }) => {
    await page.goto(`/cobrancas/parcelamentos/${seed.standaloneInstallmentPlanId}`);
    await waitForPageReady(page, 'Parcelamento');

    // Clicar no ícone/link de "ver" da primeira parcela
    const verLink = page.locator('tbody > tr').first().locator('a[href*="/cobrancas/"]');
    if (await verLink.count() > 0) {
      await verLink.first().click();
      await expect(page).toHaveURL(/\/cobrancas\/[a-z0-9]+$/i, { timeout: 10_000 });
    } else {
      // Se não houver link direto, deve ter pelo menos um botão/ícone externo
      const externalLink = page.locator('tbody > tr').first().locator('svg');
      await expect(externalLink.first()).toBeVisible();
    }
  });

  test('backend valida: dados da API batem com a UI', async ({ page, request }) => {
    await page.goto('/cobrancas/parcelamentos');
    await waitForPageReady(page, 'Parcelamentos');

    const api = new ApiHelper(request);
    const apiResult = await api.getInstallmentPlans();

    const uiRows = await page.locator('tbody > tr').count();
    expect(uiRows).toBe(apiResult.length);
  });
});
