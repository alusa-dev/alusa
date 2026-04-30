import { test, expect } from '@playwright/test';

// Pré-condição: ambiente autenticado ou página acessível sem auth (ajustar conforme necessidade).

test.describe('Sala Wizard', () => {
  test('criar sala via página /salas', async ({ page }) => {
    await page.goto('/salas');
    await page.getByRole('button', { name: /Nova sala/i }).click();
    await page.getByPlaceholder('Nome da sala').fill('Sala E2E ' + Date.now());
    await page.getByPlaceholder('Descrição (opcional)').fill('Descrição teste');
    const capInput = page.locator('input[type=number]');
    await capInput.fill('12');
    await page.getByRole('button', { name: /Próxima/i }).click();
    await page.getByRole('button', { name: /Próxima/i }).click();
    await page.getByRole('button', { name: /Concluir/i }).click();
    await expect(page.getByText(/Sala criada/i)).toBeVisible();
  });
});
