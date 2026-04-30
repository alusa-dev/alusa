import { test, expect } from '@playwright/test';

test.describe('Wizard de Modalidade', () => {
  test('criar e validar duplicidade', async ({ page }) => {
    await page.goto('/modalidades');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Nova modalidade/i }).click();
    await page.getByLabel('Nome').fill('Modalidade E2E');
    await page.getByRole('button', { name: /Próxima/i }).click();
    await page.getByRole('button', { name: /Próxima/i }).click();
    await page.getByRole('button', { name: /Concluir/i }).click();
    await expect(page.getByText('Modalidade criada')).toBeVisible();
    await page.waitForTimeout(500);
    // Tenta duplicar
    await page.getByRole('button', { name: /Nova modalidade/i }).click();
    await page.getByLabel('Nome').fill('Modalidade E2E');
    await page.getByRole('button', { name: /Próxima/i }).click();
    await page.getByRole('button', { name: /Próxima/i }).click();
    await page.getByRole('button', { name: /Concluir/i }).click();
    await expect(page.getByText(/já existe/i)).toBeVisible();
  });
});
