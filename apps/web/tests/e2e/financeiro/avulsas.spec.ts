import { test, expect } from '@playwright/test';
import { seedAdminAndLogin, prisma } from './helpers/auth';
import { seedFinanceData, type SeedResult } from './helpers/seed-finance';
import { ApiHelper, waitForPageReady } from './helpers/api';

let seed: SeedResult;

test.describe('Cobranças → Avulsas', () => {
  test.beforeEach(async ({ page }) => {
    const { contaId } = await seedAdminAndLogin(page);
    seed = await seedFinanceData(prisma, contaId);
  });

  test('lista apenas cobranças standalone soltas (sem parcelamento/assinatura)', async ({ page }) => {
    await page.goto('/cobrancas/avulsas');
    await waitForPageReady(page, 'Cobranças Avulsas');

    // Avulsas soltas devem aparecer
    await expect(page.getByText('Material didático')).toBeVisible();
    await expect(page.getByText('Uniforme escolar')).toBeVisible();

    // Parcelas de parcelamento NÃO devem aparecer (parcela 1/2 pertence a um plano)
    await expect(page.getByText('Parcela 1/2')).not.toBeVisible();

    // Mensalidades acadêmicas NÃO devem aparecer
    await expect(page.getByText('Mensalidade vigente')).not.toBeVisible();
  });

  test('clique em cobrança navega para detalhe /cobrancas/[id]', async ({ page }) => {
    await page.goto('/cobrancas/avulsas');
    await waitForPageReady(page, 'Cobranças Avulsas');

    // Clicar na primeira linha visível da tabela
    const firstRow = page.locator('tbody > tr').first();
    await firstRow.click();

    // Deve navegar para URL de detalhe
    await expect(page).toHaveURL(/\/cobrancas\/[a-z0-9]+$/i, { timeout: 10_000 });
  });

  test('backend e UI consistentes', async ({ page, request }) => {
    await page.goto('/cobrancas/avulsas');
    await waitForPageReady(page, 'Cobranças Avulsas');

    const api = new ApiHelper(request);
    const apiResult = await api.getStandaloneCharges();

    const uiRows = await page.locator('tbody > tr').count();
    expect(uiRows).toBe(apiResult.data.length);
  });
});
