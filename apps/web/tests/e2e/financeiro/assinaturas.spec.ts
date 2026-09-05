import { test, expect } from '@playwright/test';
import { seedAdminAndLogin, prisma } from './helpers/auth';
import { seedFinanceData, type SeedResult } from './helpers/seed-finance';
import { ApiHelper, waitForPageReady } from './helpers/api';

let seed: SeedResult;

test.describe('Cobranças → Assinaturas', () => {
  test.beforeEach(async ({ page }) => {
    const { contaId } = await seedAdminAndLogin(page);
    seed = await seedFinanceData(prisma, contaId);
  });

  test('lista assinaturas existentes', async ({ page }) => {
    await page.goto('/cobrancas/assinaturas');
    await waitForPageReady(page, 'Assinaturas');

    // A assinatura criada no seed deve aparecer (aluno: João Aluno E2E)
    await expect(page.getByRole('button', { name: /João Aluno E2E/ }).first()).toBeVisible();

    // A listagem atual usa uma linha semântica com role=button (desktop e mobile).
    const rows = await page.getByRole('button', { name: /João Aluno E2E/ }).count();
    expect(rows).toBeGreaterThanOrEqual(1);
  });

  test('clique navega para detalhe da assinatura', async ({ page }) => {
    await page.goto('/cobrancas/assinaturas');
    await waitForPageReady(page, 'Assinaturas');

    // Clicar na assinatura do aluno
    const row = page.getByRole('button', { name: /João Aluno E2E/ }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // Deve navegar para /cobrancas/assinaturas/[id]
    await expect(page).toHaveURL(/\/cobrancas\/assinaturas\/[a-z0-9]+$/i, { timeout: 10_000 });
  });

  test('detalhe mostra tabela de cobranças geradas', async ({ page }) => {
    await page.goto(`/cobrancas/assinaturas/${seed.subscriptionId}`);
    await waitForPageReady(page, 'Detalhes da Assinatura');

    // Deve mostrar seção "Cobranças Geradas"
    await expect(page.getByRole('heading', { name: 'Cobranças Geradas' })).toBeVisible();

    // A tela atual exibe o total e uma linha de ação para cada cobrança.
    await expect(page.getByText('4', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir' })).toHaveCount(4, { timeout: 5_000 });
  });

  test('botão "Abrir" na cobrança gerada navega para /cobrancas/[chargeId]', async ({ page }) => {
    await page.goto(`/cobrancas/assinaturas/${seed.subscriptionId}`);
    await waitForPageReady(page, 'Detalhes da Assinatura');

    // Clicar no botão "Abrir" da primeira cobrança
    const abrirButton = page.getByRole('link', { name: 'Abrir' }).first();
    await expect(abrirButton).toBeVisible();
    await abrirButton.click();

    // Deve navegar para detalhe da cobrança
    await expect(page).toHaveURL(/\/cobrancas\/[a-z0-9]+$/i, { timeout: 10_000 });
  });

  test('backend valida: dados da API batem com a UI', async ({ page }) => {
    await page.goto('/cobrancas/assinaturas');
    await waitForPageReady(page, 'Assinaturas');

    const api = new ApiHelper(page.request);
    const apiResult = await api.getSubscriptions();

    const uiRows = await page.getByRole('button', { name: /João Aluno E2E/ }).count();
    expect(uiRows).toBe(apiResult.data.length);
  });
});
