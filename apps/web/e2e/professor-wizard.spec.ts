import { test, expect } from '@playwright/test';

test.describe('Professor Wizard', () => {
  test('fluxo feliz', async ({ page }) => {
    await page.goto('/recepcao/professores');
    await page.getByRole('button', { name: 'Novo Professor' }).click();
    // Step 1
    await page.getByPlaceholder('Nome completo').fill('Prof E2E');
    await page.getByPlaceholder('000.000.000-00').fill('390.533.447-05');
    await page.getByLabel('Data de Nascimento').fill('1990-01-01');
    await page.getByRole('button', { name: 'Próximo' }).click();
    // Step 2
    await page.getByPlaceholder('email@exemplo.com').fill('prof-e2e@ex.com');
    await page.getByPlaceholder('(00) 00000-0000').fill('(11) 99999-9999');
    await page.getByRole('button', { name: 'Próximo' }).click();
    // Step 3
    await page.getByPlaceholder('Ex.: Licenciatura em Dança').fill('Licenciatura');
    await page.getByRole('button', { name: 'Próximo' }).click();
    // Step 4
    await page.getByRole('button', { name: 'Concluir' }).click();
    // Espera toast e linha (heurística simples)
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page.locator('table')).toContainText('Prof E2E');
  });
});
